import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";
import { SlimeState } from "./SlimeState";
import { WolfState } from "./WolfState";
import { WORLD_MAP, BLOCKED, MAP_W, MAP_H, NPCS, TILE } from "./tilemap";

const TILE_SIZE = 64;
const MOVE_COOLDOWN_MS = 120;
const SLIME_RESPAWN_MS = 15000;
const SLIME_MOVE_INTERVAL_MS = 800; // faster tick for chase behavior
const SLIME_ATTACK_INTERVAL_MS = 2000;
const SLIME_ATTACK_RANGE = 1;
const SLIME_CHASE_RANGE = 8; // how far slime chases after aggro
const SLIME_ATK = 8; // slime base damage
// Tibia XP formula: total XP needed to reach level L = 50/3 * (L³ - 6L² + 17L - 12)
function xpForLevel(level: number): number {
  return Math.floor((50 / 3) * (level * level * level - 6 * level * level + 17 * level - 12));
}
function levelFromXp(xp: number): number {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}
const PLAYER_RESPAWN_MS = 5000;
const SPAWN_TILE_X = 36;
const SPAWN_TILE_Y = 37;
const AUTO_ATTACK_MS = 1200; // auto-attack interval
const MANA_REGEN_MS = 2000; // regen 1 mp every 2s
const MANA_REGEN_AMT = 2;   // mp per tick
const HEAL_COST = 20;       // mana cost
const HEAL_AMOUNT = 30;     // hp restored
const POWER_SHOT_COST = 30; // ranger extra shot
const CLEAVE_COST = 30;     // warrior AoE attack

// Class configs
const CLASS_CONFIG: Record<string, { range: number; attackBase: number; hpBase: number; attackInterval: number; mpBase: number }> = {
  warrior: { range: 1, attackBase: 30, hpBase: 120, attackInterval: 1000, mpBase: 40 },
  ranger:  { range: 4, attackBase: 20, hpBase: 80,  attackInterval: 1500, mpBase: 60 },
};

const COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
  "#1abc9c", "#e67e22", "#e91e63", "#00bcd4", "#ff5722",
  "#8bc34a", "#ffc107", "#673ab7", "#03a9f4", "#ff9800",
];

// Wolf config
const WOLF_HP = 150;
const WOLF_ATK = 20;
const WOLF_XP = 75;
const WOLF_CHASE_RANGE = 8; // tiles — aggro radius
const WOLF_LEASH_RANGE = 16; // tiles — how far they chase before giving up
const WOLF_ATTACK_RANGE = 1; // melee
const WOLF_MOVE_INTERVAL_MS = 500; // slightly faster than player movement
const WOLF_ATTACK_INTERVAL_MS = 1500;
const WOLF_RESPAWN_MS = 30000;
const WOLF_SPAWN_COUNT = 8;

const SLIME_TYPES = [
  { color: "#2ecc71", size: "small", hp: 30, xp: 15, name: "Green Slime" },
  { color: "#3498db", size: "normal", hp: 50, xp: 25, name: "Blue Slime" },
  { color: "#e74c3c", size: "big", hp: 100, xp: 50, name: "Red Slime" },
  { color: "#9b59b6", size: "normal", hp: 70, xp: 35, name: "Purple Slime" },
];

const lastMoveTime = new Map<string, number>();
const lastAutoAttackTime = new Map<string, number>();
const npcDialogueIndex = new Map<string, Map<string, number>>();
const slimeLastAttack = new Map<string, number>();

const SLIME_SPAWNS: { x: number; y: number; type: number }[] = [];

function initSlimeSpawns() {
  const hash = (x: number, y: number) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) & 0x7fffffff;
  };
  for (let y = 3; y < MAP_H - 3; y += 4) {
    for (let x = 3; x < MAP_W - 3; x += 4) {
      if (x >= 26 && x <= 46 && y >= 26 && y <= 46) continue;
      const h = hash(x, y);
      if (h % 100 < 30) {
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            const tx = x + dx, ty = y + dy;
            if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
              const tile = WORLD_MAP[ty]?.[tx];
              if (tile !== undefined && !BLOCKED.has(tile) && tile !== TILE.WATER) {
                SLIME_SPAWNS.push({ x: tx, y: ty, type: h % SLIME_TYPES.length });
                dy = 3; break;
              }
            }
          }
        }
      }
    }
  }
}
initSlimeSpawns();

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: SlimeState }) slimes = new MapSchema<SlimeState>();
  @type({ map: WolfState }) wolves = new MapSchema<WolfState>();
}

function canWalk(tx: number, ty: number): boolean {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return false;
  const tile = WORLD_MAP[ty]?.[tx];
  if (tile === undefined) return false;
  return !BLOCKED.has(tile) && tile !== TILE.WATER;
}

// BFS pathfinder — prefers cardinal directions, only uses diagonals when needed
function bfsNextStep(sx: number, sy: number, gx: number, gy: number, maxDist: number): { x: number; y: number } | null {
  if (sx === gx && sy === gy) return null;
  const cardinal = [
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  ];
  const diagonal = [
    { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
  ];
  // Try cardinal-only first, then allow diagonals
  for (const dirs of [cardinal, [...cardinal, ...diagonal]]) {
    const visited = new Set<string>();
    visited.add(`${sx},${sy}`);
    const queue: [number, number, number, number][] = [];
    for (const d of dirs) {
      const nx = sx + d.dx, ny = sy + d.dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      const walkable = (nx === gx && ny === gy) ? true : canWalk(nx, ny);
      if (!walkable) continue;
      if (nx >= 28 && nx <= 44 && ny >= 28 && ny <= 44) continue;
      visited.add(key);
      if (nx === gx && ny === gy) return { x: nx, y: ny };
      queue.push([nx, ny, nx, ny]);
    }
    let head = 0;
    while (head < queue.length) {
      const [cx, cy, fx, fy] = queue[head++];
      if (Math.abs(cx - sx) > maxDist || Math.abs(cy - sy) > maxDist) continue;
      for (const d of dirs) {
        const nx = cx + d.dx, ny = cy + d.dy;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        const walkable = (nx === gx && ny === gy) ? true : canWalk(nx, ny);
        if (!walkable) continue;
        if (nx >= 28 && nx <= 44 && ny >= 28 && ny <= 44) continue;
        visited.add(key);
        if (nx === gx && ny === gy) return { x: fx, y: fy };
        queue.push([nx, ny, fx, fy]);
      }
    }
    // If cardinal-only found a path, we already returned. Try with diagonals next.
  }
  return null;
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  // Chebyshev distance — diagonals count as 1
  return Math.max(
    Math.abs(Math.round(x1 / TILE_SIZE) - Math.round(x2 / TILE_SIZE)),
    Math.abs(Math.round(y1 / TILE_SIZE) - Math.round(y2 / TILE_SIZE))
  );
}

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  isTileOccupiedByPlayer(newX: number, newY: number, excludeSessionId: string): boolean {
    let occupied = false;
    this.state.players.forEach((p, sid) => {
      if (sid !== excludeSessionId && p.x === newX && p.y === newY && p.hp > 0) occupied = true;
    });
    return occupied;
  }

  isTileOccupiedByMonster(newX: number, newY: number, excludeSlimeId?: string, excludeWolfId?: string): boolean {
    for (const [id, slime] of this.state.slimes) {
      if (id === excludeSlimeId || !slime.alive) continue;
      if (slime.x === newX && slime.y === newY) return true;
    }
    for (const [id, wolf] of this.state.wolves) {
      if (id === excludeWolfId || !wolf.alive) continue;
      if (wolf.x === newX && wolf.y === newY) return true;
    }
    return false;
  }

  respawnPlayer(player: PlayerState) {
    // Death penalty — Tibia style
    const level = levelFromXp(player.xp);
    if (level < 24) {
      // Levels 1-23: lose 10% of total XP
      const loss = Math.floor(player.xp * 0.10);
      player.xp = Math.max(0, player.xp - loss);
    } else {
      // Level 24+: lose ((level + 50) / 100) * 50(level² - 5*level + 8)
      const loss = Math.floor(((level + 50) / 100) * 50 * (level * level - 5 * level + 8));
      player.xp = Math.max(0, player.xp - loss);
    }

    // Recalculate level after XP loss (may delevel)
    const newLevel = levelFromXp(player.xp);
    const cfg = CLASS_CONFIG[player.playerClass] || CLASS_CONFIG.warrior;
    player.level = newLevel;
    player.maxHp = cfg.hpBase + (newLevel - 1) * 20;
    player.maxMp = cfg.mpBase + (newLevel - 1) * 10;
    player.attack = cfg.attackBase + (newLevel - 1) * 5;

    player.x = SPAWN_TILE_X * TILE_SIZE;
    player.y = SPAWN_TILE_Y * TILE_SIZE;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    player.direction = "down";
    player.moving = false;
    player.targetId = "";
  }

  // Perform one attack from player against their target
  performAttack(client: Client, player: PlayerState) {
    if (!player.targetId || player.hp <= 0) return;

    const cfg = CLASS_CONFIG[player.playerClass] || CLASS_CONFIG.warrior;
    const px = player.x, py = player.y;

    // Try slime target
    const slime = this.state.slimes.get(player.targetId);
    if (slime && slime.alive) {
      const d = dist(px, py, slime.x, slime.y);
      if (d > cfg.range) {
        // Out of range — clear target for warrior, keep for ranger
        if (player.playerClass === "warrior") player.targetId = "";
        return;
      }
      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      slime.hp = Math.max(0, slime.hp - damage);
      slime.targetPlayerId = client.sessionId; // aggro on attacker

      // For ranger, send projectile
      if (player.playerClass === "ranger") {
        this.broadcast("projectile", {
          fromX: px + TILE_SIZE / 2, fromY: py,
          toX: slime.x + TILE_SIZE / 2, toY: slime.y,
          attackerId: client.sessionId,
        });
      }

      this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });

      if (slime.hp <= 0) {
        slime.alive = false;
        slime.targetPlayerId = "";
        player.targetId = "";
        const spawnIdx = parseInt(player.targetId.split("_")[1]) || 0;
        // Find spawn index from ID
        let sIdx = 0;
        const parts = player.targetId.split("_");
        // targetId already cleared, use the slime's id from the map
        this.state.slimes.forEach((s, id) => {
          if (s === slime) {
            const idx = parseInt(id.split("_")[1]);
            if (!isNaN(idx)) sIdx = idx;
          }
        });

        const xpGain = SLIME_TYPES[SLIME_SPAWNS[sIdx]?.type || 0]?.xp || 25;
        player.xp += xpGain;

        const newLevel = levelFromXp(player.xp);
        if (newLevel > player.level) {
          player.level = newLevel;
          player.maxHp = cfg.hpBase + (newLevel - 1) * 20;
          player.hp = player.maxHp;
          player.attack = cfg.attackBase + (newLevel - 1) * 5;
          player.maxMp = cfg.mpBase + (newLevel - 1) * 10;
          player.mp = player.maxMp;
          this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel });
        }

        this.broadcast("kill", { targetId: `slime_${sIdx}`, killerId: client.sessionId, killerName: player.name, xp: xpGain });

        this.clock.setTimeout(() => {
          const spawn = SLIME_SPAWNS[sIdx];
          if (spawn) {
            const type = SLIME_TYPES[spawn.type];
            slime.x = spawn.x * TILE_SIZE;
            slime.y = spawn.y * TILE_SIZE;
            slime.hp = type.hp; slime.maxHp = type.hp;
            slime.targetPlayerId = "";
            slime.alive = true;
          }
        }, SLIME_RESPAWN_MS);
      }
      return;
    }

    // Try wolf target
    const wolf = this.state.wolves.get(player.targetId);
    if (wolf && wolf.alive) {
      const d = dist(px, py, wolf.x, wolf.y);
      if (d > cfg.range) {
        if (player.playerClass === "warrior") player.targetId = "";
        return;
      }
      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      wolf.hp = Math.max(0, wolf.hp - damage);

      if (player.playerClass === "ranger") {
        this.broadcast("projectile", {
          fromX: px + TILE_SIZE / 2, fromY: py,
          toX: wolf.x + TILE_SIZE / 2, toY: wolf.y,
          attackerId: client.sessionId,
        });
      }

      this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });

      if (wolf.hp <= 0) {
        wolf.alive = false;
        const wolfId = player.targetId;
        player.targetId = "";

        const xpGain = WOLF_XP;
        player.xp += xpGain;

        const newLevel = levelFromXp(player.xp);
        if (newLevel > player.level) {
          player.level = newLevel;
          player.maxHp = cfg.hpBase + (newLevel - 1) * 20;
          player.hp = player.maxHp;
          player.attack = cfg.attackBase + (newLevel - 1) * 5;
          player.maxMp = cfg.mpBase + (newLevel - 1) * 10;
          player.mp = player.maxMp;
          this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel });
        }

        this.broadcast("kill", { targetId: wolfId, killerId: client.sessionId, killerName: player.name, xp: xpGain });

        // Find spawn index
        const wIdx = parseInt(wolfId.split("_")[1]) || 0;
        this.clock.setTimeout(() => {
            wolf.x = wolf.spawnX;
            wolf.y = wolf.spawnY;
            wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP;
            wolf.alive = true;
            wolf.targetPlayerId = "";
        }, WOLF_RESPAWN_MS);
      }
      return;
    }

    // Try player target (PvP)
    const target = this.state.players.get(player.targetId);
    if (target && target.hp > 0) {
      const d = dist(px, py, target.x, target.y);
      if (d > cfg.range) {
        if (player.playerClass === "warrior") player.targetId = "";
        return;
      }
      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      target.hp = Math.max(0, target.hp - damage);

      if (player.playerClass === "ranger") {
        this.broadcast("projectile", {
          fromX: px + TILE_SIZE / 2, fromY: py,
          toX: target.x + TILE_SIZE / 2, toY: target.y,
          attackerId: client.sessionId,
        });
      }

      this.broadcast("pvp_hit", {
        targetId: player.targetId, attackerId: client.sessionId,
        attackerName: player.name, damage,
      });

      if (target.hp <= 0) {
        const xpGain = 50 + target.level * 10;
        player.xp += xpGain;
        player.targetId = "";

        const newLevel = levelFromXp(player.xp);
        if (newLevel > player.level) {
          player.level = newLevel;
          player.maxHp = cfg.hpBase + (newLevel - 1) * 20;
          player.hp = player.maxHp;
          player.attack = cfg.attackBase + (newLevel - 1) * 5;
          player.maxMp = cfg.mpBase + (newLevel - 1) * 10;
          player.mp = player.maxMp;
          this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel });
        }

        this.broadcast("pvp_kill", {
          killerId: client.sessionId, killerName: player.name,
          targetId: player.targetId, targetName: target.name, xp: xpGain,
        });

        this.clock.setTimeout(() => { this.respawnPlayer(target); }, PLAYER_RESPAWN_MS);
      }
      return;
    }

    // Target invalid — clear
    player.targetId = "";
  }

  onCreate() {
    this.setState(new GameState());

    // Spawn slimes
    SLIME_SPAWNS.forEach((spawn, i) => {
      const slime = new SlimeState();
      const type = SLIME_TYPES[spawn.type];
      slime.id = `slime_${i}`;
      slime.x = spawn.x * TILE_SIZE;
      slime.y = spawn.y * TILE_SIZE;
      slime.hp = type.hp;
      slime.maxHp = type.hp;
      slime.color = type.color;
      slime.size = type.size;
      slime.alive = true;
      this.state.slimes.set(slime.id, slime);
    });

    // Spawn wolves in forest areas (away from village)
    const wolfSpawns: { x: number; y: number }[] = [];
    for (let attempt = 0; attempt < 200 && wolfSpawns.length < WOLF_SPAWN_COUNT; attempt++) {
      const wx = Math.floor(Math.random() * MAP_W);
      const wy = Math.floor(Math.random() * MAP_H);
      // Not in village zone, walkable, not water
      if (wx >= 24 && wx <= 48 && wy >= 24 && wy <= 48) continue;
      if (!canWalk(wx, wy)) continue;
      // Some distance from other wolves
      if (wolfSpawns.some(w => Math.abs(w.x - wx) + Math.abs(w.y - wy) < 4)) continue;
      wolfSpawns.push({ x: wx, y: wy });
    }
    (this as any)._wolfSpawns = wolfSpawns;
    wolfSpawns.forEach((spawn, i) => {
      const wolf = new WolfState();
      wolf.id = `wolf_${i}`;
      wolf.x = spawn.x * TILE_SIZE;
      wolf.y = spawn.y * TILE_SIZE;
      wolf.spawnX = wolf.x;
      wolf.spawnY = wolf.y;
      wolf.hp = WOLF_HP;
      wolf.maxHp = WOLF_HP;
      wolf.alive = true;
      this.state.wolves.set(wolf.id, wolf);
    });

    // Wolf AI — chase & attack
    const wolfLastAttack = new Map<string, number>();
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.wolves.forEach((wolf) => {
        if (!wolf.alive) return;
        const wtx = Math.round(wolf.x / TILE_SIZE);
        const wty = Math.round(wolf.y / TILE_SIZE);

        // Find closest player in range
        let closest: PlayerState | null = null;
        let closestSid = "";
        let closestDist = Infinity;
        this.state.players.forEach((p, sid) => {
          if (p.hp <= 0) return;
          const d = Math.max(Math.abs(Math.round(p.x / TILE_SIZE) - wtx), Math.abs(Math.round(p.y / TILE_SIZE) - wty));
          if (d <= WOLF_CHASE_RANGE && d < closestDist) {
            closest = p;
            closestSid = sid;
            closestDist = d;
          }
        });

        // If already aggroed, keep chasing up to leash range
        if (!closest && wolf.targetPlayerId) {
          const tracked = this.state.players.get(wolf.targetPlayerId);
          if (tracked && tracked.hp > 0) {
            const d = Math.max(Math.abs(Math.round(tracked.x / TILE_SIZE) - wtx), Math.abs(Math.round(tracked.y / TILE_SIZE) - wty));
            if (d <= WOLF_LEASH_RANGE) {
              closest = tracked;
              closestSid = wolf.targetPlayerId;
              closestDist = d;
            }
          }
        }

        if (!closest) {
          wolf.targetPlayerId = "";
          // Random wander when no target
          if (Math.random() > 0.3) return;
          const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          const dir = dirs[Math.floor(Math.random() * dirs.length)];
          const nx = wolf.x + dir.dx * TILE_SIZE;
          const ny = wolf.y + dir.dy * TILE_SIZE;
          const ntx = Math.round(nx / TILE_SIZE), nty = Math.round(ny / TILE_SIZE);
          if (!canWalk(ntx, nty)) return;
          if (ntx >= 28 && ntx <= 44 && nty >= 28 && nty <= 44) return; // don't enter village
          wolf.x = nx;
          wolf.y = ny;
          return;
        }

        wolf.targetPlayerId = closestSid;

        // Attack if adjacent
        if (closestDist <= WOLF_ATTACK_RANGE) {
          const last = wolfLastAttack.get(wolf.id) || 0;
          if (now - last >= WOLF_ATTACK_INTERVAL_MS) {
            wolfLastAttack.set(wolf.id, now);
            const damage = WOLF_ATK + Math.floor(Math.random() * 8);
            closest.hp = Math.max(0, closest.hp - damage);
            this.broadcast("hit", {
              targetId: closestSid,
              damage,
              x: closest.x + TILE_SIZE / 2,
              y: closest.y,
              attackerId: wolf.id,
            });
            if (closest.hp <= 0) {
              wolf.targetPlayerId = "";
              this.broadcast("kill", { targetId: closestSid, killerId: wolf.id, killerName: "Wolf", xp: 0 });
              this.clock.setTimeout(() => { this.respawnPlayer(closest!); }, PLAYER_RESPAWN_MS);
            }
          }
          return;
        }

        // Chase — BFS pathfind toward player (avoids getting stuck on obstacles)
        const ptx = Math.round(closest.x / TILE_SIZE);
        const pty = Math.round(closest.y / TILE_SIZE);
        const step = bfsNextStep(wtx, wty, ptx, pty, WOLF_LEASH_RANGE);
        if (step && !this.isTileOccupiedByMonster(step.x * TILE_SIZE, step.y * TILE_SIZE, undefined, wolf.id)) {
          wolf.x = step.x * TILE_SIZE;
          wolf.y = step.y * TILE_SIZE;
        }
      });
    }, WOLF_MOVE_INTERVAL_MS);

    // Slime AI — neutral until attacked, then chase + fight
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.slimes.forEach((slime, slimeId) => {
        if (!slime.alive) return;
        const stx = Math.round(slime.x / TILE_SIZE);
        const sty = Math.round(slime.y / TILE_SIZE);

        // If aggroed, chase and attack
        if (slime.targetPlayerId) {
          const target = this.state.players.get(slime.targetPlayerId);
          if (!target || target.hp <= 0) {
            slime.targetPlayerId = ""; // target gone, de-aggro
            return;
          }
          const d = dist(slime.x, slime.y, target.x, target.y);
          if (d > SLIME_CHASE_RANGE) {
            slime.targetPlayerId = ""; // too far, de-aggro
            return;
          }

          // Attack if in range
          if (d <= SLIME_ATTACK_RANGE) {
            const last = slimeLastAttack.get(slimeId) || 0;
            if (now - last >= SLIME_ATTACK_INTERVAL_MS) {
              slimeLastAttack.set(slimeId, now);
              const damage = SLIME_ATK + Math.floor(Math.random() * 6);
              target.hp = Math.max(0, target.hp - damage);
              this.broadcast("hit", {
                targetId: slime.targetPlayerId,
                damage,
                x: target.x + TILE_SIZE / 2,
                y: target.y,
                attackerId: slimeId,
              });
              if (target.hp <= 0) {
                slime.targetPlayerId = "";
                this.broadcast("kill", { targetId: slime.targetPlayerId, killerId: slimeId, killerName: "Slime", xp: 0 });
                this.clock.setTimeout(() => { this.respawnPlayer(target); }, PLAYER_RESPAWN_MS);
              }
            }
            return; // don't move while attacking
          }

          // Chase — BFS pathfind toward player
          const ptx = Math.round(target.x / TILE_SIZE);
          const pty = Math.round(target.y / TILE_SIZE);
          const step = bfsNextStep(stx, sty, ptx, pty, SLIME_CHASE_RANGE);
          if (step && !this.isTileOccupiedByMonster(step.x * TILE_SIZE, step.y * TILE_SIZE, slimeId)) {
            slime.x = step.x * TILE_SIZE;
            slime.y = step.y * TILE_SIZE;
          }
          return;
        }

        // Neutral — random wander
        if (Math.random() > 0.15) return; // wander less often
        const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const newX = slime.x + dir.dx * TILE_SIZE;
        const newY = slime.y + dir.dy * TILE_SIZE;
        const tx = Math.round(newX / TILE_SIZE), ty = Math.round(newY / TILE_SIZE);
        if (!canWalk(tx, ty)) return;
        if (tx >= 28 && tx <= 44 && ty >= 28 && ty <= 44) return;
        if (NPCS.some(n => n.x === tx && n.y === ty)) return;
        if (this.isTileOccupiedByMonster(newX, newY, slimeId)) return;
        slime.x = newX;
        slime.y = newY;
      });
    }, SLIME_MOVE_INTERVAL_MS);

    // Auto-attack tick — runs frequently, each player attacks on their own interval
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.players.forEach((player, sid) => {
        if (!player.targetId || player.hp <= 0) return;
        const cfg = CLASS_CONFIG[player.playerClass] || CLASS_CONFIG.warrior;
        const last = lastAutoAttackTime.get(sid) || 0;
        if (now - last < cfg.attackInterval) return;
        lastAutoAttackTime.set(sid, now);

        // Find the client
        for (const client of this.clients) {
          if (client.sessionId === sid) {
            this.performAttack(client, player);
            break;
          }
        }
      });
    }, 200); // check every 200ms

    // Mana regen tick
    this.clock.setInterval(() => {
      this.state.players.forEach((player) => {
        if (player.hp <= 0) return;
        if (player.mp < player.maxMp) {
          player.mp = Math.min(player.maxMp, player.mp + MANA_REGEN_AMT);
        }
      });
    }, MANA_REGEN_MS);

    // ── Movement ──
    this.onMessage("move", (client, data: { dx: number; dy: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;

      const now = Date.now();
      const last = lastMoveTime.get(client.sessionId) || 0;
      if (now - last < MOVE_COOLDOWN_MS) return;

      let dx = Math.max(-1, Math.min(1, Math.round(data.dx)));
      let dy = Math.max(-1, Math.min(1, Math.round(data.dy)));
      if (dx !== 0 && dy !== 0) dy = 0;
      if (dx === 0 && dy === 0) return;

      // Always update direction, even if move is blocked
      if (dy < 0) player.direction = "up";
      else if (dy > 0) player.direction = "down";
      else if (dx < 0) player.direction = "left";
      else if (dx > 0) player.direction = "right";

      const newX = player.x + dx * TILE_SIZE;
      const newY = player.y + dy * TILE_SIZE;
      const tileX = Math.round(newX / TILE_SIZE);
      const tileY = Math.round(newY / TILE_SIZE);

      if (!canWalk(tileX, tileY)) {
        lastMoveTime.set(client.sessionId, now);
        return;
      }
      if (NPCS.some(n => n.x === tileX && n.y === tileY)) {
        lastMoveTime.set(client.sessionId, now);
        return;
      }
      if (this.isTileOccupiedByPlayer(newX, newY, client.sessionId)) {
        lastMoveTime.set(client.sessionId, now);
        return;
      }

      let monsterBlocking = false;
      this.state.slimes.forEach((slime) => {
        if (slime.alive && slime.x === newX && slime.y === newY) monsterBlocking = true;
      });
      this.state.wolves.forEach((wolf) => {
        if (wolf.alive && wolf.x === newX && wolf.y === newY) monsterBlocking = true;
      });
      if (monsterBlocking) {
        lastMoveTime.set(client.sessionId, now);
        return;
      }

      player.x = newX;
      player.y = newY;
      player.moving = true;
      lastMoveTime.set(client.sessionId, now);

      this.clock.setTimeout(() => { if (player.moving) player.moving = false; }, MOVE_COOLDOWN_MS);
    });

    this.onMessage("stop", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.moving = false;
    });

    // ── Set target (click to target) ──
    this.onMessage("set_target", (client, data: { targetId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;

      const tid = data.targetId || "";

      // Validate target exists
      if (tid) {
        const slime = this.state.slimes.get(tid);
        const wolf = this.state.wolves.get(tid);
        const targetPlayer = this.state.players.get(tid);
        const valid = (slime && slime.alive) || (wolf && wolf.alive) || (targetPlayer && targetPlayer.hp > 0 && tid !== client.sessionId);
        if (!valid) {
          player.targetId = "";
          return;
        }
      }

      player.targetId = tid;
      // Reset attack timer so first attack happens after interval
      lastAutoAttackTime.set(client.sessionId, Date.now());
    });

    // ── Clear target ──
    this.onMessage("clear_target", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.targetId = "";
    });

    // ── Chat ──
    this.onMessage("chat", (client, data: { message: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const msg = (data.message || "").trim().slice(0, 100);
      if (!msg) return;
      this.broadcast("chat", { sessionId: client.sessionId, name: player.name, message: msg });
    });

    // ── Emote ──
    this.onMessage("emote", (client, data: { index: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const emotes = ["👋", "😂", "❤️", "⚔️", "🎉"];
      const idx = Math.max(0, Math.min(emotes.length - 1, data.index));
      this.broadcast("emote", { sessionId: client.sessionId, emote: emotes[idx] });
    });

    // ── NPC Talk ──
    this.onMessage("npc_talk", (client, data: { npcId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const npc = NPCS.find(n => n.id === data.npcId);
      if (!npc) return;
      const px = Math.round(player.x / TILE_SIZE), py = Math.round(player.y / TILE_SIZE);
      if (Math.abs(px - npc.x) + Math.abs(py - npc.y) > 2) return;

      if (!npcDialogueIndex.has(client.sessionId)) npcDialogueIndex.set(client.sessionId, new Map());
      const pd = npcDialogueIndex.get(client.sessionId)!;
      const idx = pd.get(npc.id) || 0;
      client.send("npc_dialogue", { npcId: npc.id, name: npc.name, message: npc.dialogue[idx % npc.dialogue.length] });
      pd.set(npc.id, (idx + 1) % npc.dialogue.length);
    });

    // ── Heal spell ──
    this.onMessage("heal", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (player.mp < HEAL_COST) return;
      if (player.hp >= player.maxHp) return;
      player.mp -= HEAL_COST;
      const healed = Math.min(HEAL_AMOUNT, player.maxHp - player.hp);
      player.hp += healed;
      this.broadcast("heal_effect", { sessionId: client.sessionId, amount: healed });
    });

    // ── Power Shot (Ranger) — extra arrow that doesn't reset attack timer ──
    this.onMessage("power_shot", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (player.playerClass !== "ranger") return;
      if (player.mp < POWER_SHOT_COST) return;
      if (!player.targetId) return;

      const cfg = CLASS_CONFIG.ranger;
      const px = player.x, py = player.y;

      // Check slime target
      const slime = this.state.slimes.get(player.targetId);
      if (slime && slime.alive) {
        const d = dist(px, py, slime.x, slime.y);
        if (d > cfg.range) return;
        player.mp -= POWER_SHOT_COST;
        const damage = Math.max(1, Math.floor(player.attack * 1.5) + Math.floor(Math.random() * 10) - 5);
        slime.hp = Math.max(0, slime.hp - damage);
        slime.targetPlayerId = client.sessionId;
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: slime.x + TILE_SIZE / 2, toY: slime.y });
        this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });
        if (slime.hp <= 0) {
          slime.alive = false; slime.targetPlayerId = "";
          player.targetId = "";
          let sIdx = 0;
          this.state.slimes.forEach((s, id) => { if (s === slime) { const idx = parseInt(id.split("_")[1]); if (!isNaN(idx)) sIdx = idx; } });
          const xpGain = SLIME_TYPES[SLIME_SPAWNS[sIdx]?.type || 0]?.xp || 25;
          player.xp += xpGain;
          const newLevel = levelFromXp(player.xp);
          if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
          this.broadcast("kill", { targetId: `slime_${sIdx}`, killerId: client.sessionId, killerName: player.name, xp: xpGain });
          this.clock.setTimeout(() => { const spawn = SLIME_SPAWNS[sIdx]; if (spawn) { const type = SLIME_TYPES[spawn.type]; slime.x = spawn.x * TILE_SIZE; slime.y = spawn.y * TILE_SIZE; slime.hp = type.hp; slime.maxHp = type.hp; slime.targetPlayerId = ""; slime.alive = true; } }, SLIME_RESPAWN_MS);
        }
        return;
      }

      // Check wolf target
      const wolf = this.state.wolves.get(player.targetId);
      if (wolf && wolf.alive) {
        const d = dist(px, py, wolf.x, wolf.y);
        if (d > cfg.range) return;
        player.mp -= POWER_SHOT_COST;
        const damage = Math.max(1, Math.floor(player.attack * 1.5) + Math.floor(Math.random() * 10) - 5);
        wolf.hp = Math.max(0, wolf.hp - damage);
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: wolf.x + TILE_SIZE / 2, toY: wolf.y });
        this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });
        if (wolf.hp <= 0) {
          wolf.alive = false; wolf.targetPlayerId = ""; player.targetId = "";
          player.xp += WOLF_XP;
          const newLevel = levelFromXp(player.xp);
          if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
          this.broadcast("kill", { targetId: player.targetId, killerId: client.sessionId, killerName: player.name, xp: WOLF_XP });
          this.clock.setTimeout(() => { wolf.x = wolf.spawnX; wolf.y = wolf.spawnY; wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP; wolf.targetPlayerId = ""; wolf.alive = true; }, WOLF_RESPAWN_MS);
        }
        return;
      }

      // Check player target (PvP)
      const target = this.state.players.get(player.targetId);
      if (target && target.hp > 0) {
        const d = dist(px, py, target.x, target.y);
        if (d > cfg.range) return;
        player.mp -= POWER_SHOT_COST;
        const damage = Math.max(1, Math.floor(player.attack * 1.5) + Math.floor(Math.random() * 10) - 5);
        target.hp = Math.max(0, target.hp - damage);
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: target.x + TILE_SIZE / 2, toY: target.y });
        this.broadcast("pvp_hit", { targetId: player.targetId, attackerName: player.name, damage });
        if (target.hp <= 0) { player.targetId = ""; const xpGain = 50 + target.level * 10; player.xp += xpGain; this.broadcast("pvp_kill", { killerName: player.name, targetName: target.name, xp: xpGain }); this.clock.setTimeout(() => { this.respawnPlayer(target); }, PLAYER_RESPAWN_MS); }
      }
    });

    // ── Cleave (Warrior) — hit ALL adjacent enemies ──
    this.onMessage("cleave", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (player.playerClass !== "warrior") return;
      if (player.mp < CLEAVE_COST) return;
      player.mp -= CLEAVE_COST;

      const cfg = CLASS_CONFIG.warrior;
      const px = player.x, py = player.y;
      let hitCount = 0;

      // Hit all adjacent slimes
      this.state.slimes.forEach((slime, slimeId) => {
        if (!slime.alive) return;
        const d = dist(px, py, slime.x, slime.y);
        if (d > 1) return;
        const damage = Math.max(1, Math.floor(player.attack * 1.2) + Math.floor(Math.random() * 10) - 5);
        slime.hp = Math.max(0, slime.hp - damage);
        slime.targetPlayerId = client.sessionId;
        this.broadcast("hit", { targetId: slimeId, damage, attackerId: client.sessionId });
        hitCount++;
        if (slime.hp <= 0) {
          slime.alive = false; slime.targetPlayerId = "";
          if (player.targetId === slimeId) player.targetId = "";
          let sIdx = 0;
          this.state.slimes.forEach((s, id) => { if (s === slime) { const idx = parseInt(id.split("_")[1]); if (!isNaN(idx)) sIdx = idx; } });
          const xpGain = SLIME_TYPES[SLIME_SPAWNS[sIdx]?.type || 0]?.xp || 25;
          player.xp += xpGain;
          this.broadcast("kill", { targetId: `slime_${sIdx}`, killerId: client.sessionId, killerName: player.name, xp: xpGain });
          this.clock.setTimeout(() => { const spawn = SLIME_SPAWNS[sIdx]; if (spawn) { const type = SLIME_TYPES[spawn.type]; slime.x = spawn.x * TILE_SIZE; slime.y = spawn.y * TILE_SIZE; slime.hp = type.hp; slime.maxHp = type.hp; slime.targetPlayerId = ""; slime.alive = true; } }, SLIME_RESPAWN_MS);
        }
      });

      // Hit all adjacent wolves
      this.state.wolves.forEach((wolf, wolfId) => {
        if (!wolf.alive) return;
        const d = dist(px, py, wolf.x, wolf.y);
        if (d > 1) return;
        const damage = Math.max(1, Math.floor(player.attack * 1.2) + Math.floor(Math.random() * 10) - 5);
        wolf.hp = Math.max(0, wolf.hp - damage);
        this.broadcast("hit", { targetId: wolfId, damage, attackerId: client.sessionId });
        hitCount++;
        if (wolf.hp <= 0) {
          wolf.alive = false; wolf.targetPlayerId = "";
          if (player.targetId === wolfId) player.targetId = "";
          player.xp += WOLF_XP;
          this.broadcast("kill", { targetId: wolfId, killerId: client.sessionId, killerName: player.name, xp: WOLF_XP });
          this.clock.setTimeout(() => { wolf.x = wolf.spawnX; wolf.y = wolf.spawnY; wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP; wolf.targetPlayerId = ""; wolf.alive = true; }, WOLF_RESPAWN_MS);
        }
      });

      // Hit all adjacent players
      this.state.players.forEach((target, sid) => {
        if (sid === client.sessionId || target.hp <= 0) return;
        const d = dist(px, py, target.x, target.y);
        if (d > 1) return;
        const damage = Math.max(1, Math.floor(player.attack * 1.2) + Math.floor(Math.random() * 10) - 5);
        target.hp = Math.max(0, target.hp - damage);
        this.broadcast("pvp_hit", { targetId: sid, attackerName: player.name, damage });
        hitCount++;
        if (target.hp <= 0) { if (player.targetId === sid) player.targetId = ""; const xpGain = 50 + target.level * 10; player.xp += xpGain; this.broadcast("pvp_kill", { killerName: player.name, targetName: target.name, xp: xpGain }); this.clock.setTimeout(() => { this.respawnPlayer(target); }, PLAYER_RESPAWN_MS); }
      });

      // Check for level up
      const newLevel = levelFromXp(player.xp);
      if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }

      // Broadcast cleave visual
      this.broadcast("cleave_effect", { sessionId: client.sessionId, x: px, y: py, hits: hitCount });
    });

    console.log(`GameRoom created with ${SLIME_SPAWNS.length} slime spawns`);
  }

  onJoin(client: Client, options: { name?: string; playerClass?: string; savedXp?: number }) {
    const player = new PlayerState();
    const cls = (options.playerClass === "ranger") ? "ranger" : "warrior";
    const cfg = CLASS_CONFIG[cls];

    // Restore saved progress
    const xp = Math.max(0, Math.min(options.savedXp || 0, 1000000)); // cap XP
    const level = levelFromXp(xp);

    player.x = SPAWN_TILE_X * TILE_SIZE;
    player.y = SPAWN_TILE_Y * TILE_SIZE;
    player.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    player.name = options.name || "Anonymous";
    player.direction = "down";
    player.moving = false;
    player.playerClass = cls;
    player.hp = cfg.hpBase + (level - 1) * 20;
    player.maxHp = cfg.hpBase + (level - 1) * 20;
    player.mp = cfg.mpBase + (level - 1) * 10;
    player.maxMp = cfg.mpBase + (level - 1) * 10;
    player.xp = xp;
    player.level = level;
    player.attack = cfg.attackBase + (level - 1) * 5;
    player.targetId = "";

    this.state.players.set(client.sessionId, player);
    lastMoveTime.set(client.sessionId, 0);
    lastAutoAttackTime.set(client.sessionId, 0);
    npcDialogueIndex.set(client.sessionId, new Map());

    client.send("world_data", { map: WORLD_MAP, npcs: NPCS, mapW: MAP_W, mapH: MAP_H });
    console.log(`${player.name} (${cls}) joined (${client.sessionId})`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) console.log(`${player.name} left (${client.sessionId})`);
    this.state.players.delete(client.sessionId);
    lastMoveTime.delete(client.sessionId);
    lastAutoAttackTime.delete(client.sessionId);
    npcDialogueIndex.delete(client.sessionId);
  }

  onDispose() { console.log("GameRoom disposed"); }
}
