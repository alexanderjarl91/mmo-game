import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";
import { SlimeState } from "./SlimeState";
import { WolfState } from "./WolfState";
import { WORLD_MAP, BLOCKED, MAP_W, MAP_H, NPCS, TILE } from "./tilemap";

const TILE_SIZE = 64;
const MOVE_COOLDOWN_MS = 120;
const SLIME_RESPAWN_MS = 15000;
const SLIME_MOVE_INTERVAL_MS = 2000;
const XP_PER_LEVEL = 100;
const PLAYER_RESPAWN_MS = 5000;
const SPAWN_TILE_X = 36;
const SPAWN_TILE_Y = 37;
const AUTO_ATTACK_MS = 1200; // auto-attack interval

// Class configs
const CLASS_CONFIG: Record<string, { range: number; attackBase: number; hpBase: number; attackInterval: number }> = {
  warrior: { range: 1, attackBase: 30, hpBase: 120, attackInterval: 1000 },
  ranger:  { range: 3, attackBase: 20, hpBase: 80,  attackInterval: 1500 },
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

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(Math.round(x1 / TILE_SIZE) - Math.round(x2 / TILE_SIZE)) +
         Math.abs(Math.round(y1 / TILE_SIZE) - Math.round(y2 / TILE_SIZE));
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

  respawnPlayer(player: PlayerState) {
    player.x = SPAWN_TILE_X * TILE_SIZE;
    player.y = SPAWN_TILE_Y * TILE_SIZE;
    player.hp = player.maxHp;
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

        const newLevel = Math.floor(player.xp / XP_PER_LEVEL) + 1;
        if (newLevel > player.level) {
          player.level = newLevel;
          player.maxHp = cfg.hpBase + (newLevel - 1) * 20;
          player.hp = player.maxHp;
          player.attack = cfg.attackBase + (newLevel - 1) * 5;
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

        const newLevel = Math.floor(player.xp / XP_PER_LEVEL) + 1;
        if (newLevel > player.level) {
          player.level = newLevel;
          player.maxHp = cfg.hpBase + (newLevel - 1) * 20;
          player.hp = player.maxHp;
          player.attack = cfg.attackBase + (newLevel - 1) * 5;
          this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel });
        }

        this.broadcast("kill", { targetId: wolfId, killerId: client.sessionId, killerName: player.name, xp: xpGain });

        // Find spawn index
        const wIdx = parseInt(wolfId.split("_")[1]) || 0;
        this.clock.setTimeout(() => {
          const spawns = (this as any)._wolfSpawns;
          const spawn = spawns?.[wIdx];
          if (spawn) {
            wolf.x = spawn.x * TILE_SIZE;
            wolf.y = spawn.y * TILE_SIZE;
            wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP;
            wolf.alive = true;
            wolf.targetPlayerId = "";
          }
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

        const newLevel = Math.floor(player.xp / XP_PER_LEVEL) + 1;
        if (newLevel > player.level) {
          player.level = newLevel;
          player.maxHp = cfg.hpBase + (newLevel - 1) * 20;
          player.hp = player.maxHp;
          player.attack = cfg.attackBase + (newLevel - 1) * 5;
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
          const d = Math.abs(Math.round(p.x / TILE_SIZE) - wtx) + Math.abs(Math.round(p.y / TILE_SIZE) - wty);
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
            const d = Math.abs(Math.round(tracked.x / TILE_SIZE) - wtx) + Math.abs(Math.round(tracked.y / TILE_SIZE) - wty);
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

        // Chase — move toward player
        const ptx = Math.round(closest.x / TILE_SIZE);
        const pty = Math.round(closest.y / TILE_SIZE);
        const dx = ptx - wtx;
        const dy = pty - wty;
        // Prefer the axis with larger distance
        const moves: { dx: number; dy: number }[] = [];
        if (Math.abs(dx) >= Math.abs(dy)) {
          if (dx !== 0) moves.push({ dx: Math.sign(dx), dy: 0 });
          if (dy !== 0) moves.push({ dx: 0, dy: Math.sign(dy) });
        } else {
          if (dy !== 0) moves.push({ dx: 0, dy: Math.sign(dy) });
          if (dx !== 0) moves.push({ dx: Math.sign(dx), dy: 0 });
        }
        for (const m of moves) {
          const nx = wolf.x + m.dx * TILE_SIZE;
          const ny = wolf.y + m.dy * TILE_SIZE;
          const ntx = Math.round(nx / TILE_SIZE), nty = Math.round(ny / TILE_SIZE);
          if (!canWalk(ntx, nty)) continue;
          if (ntx >= 28 && ntx <= 44 && nty >= 28 && nty <= 44) continue;
          wolf.x = nx;
          wolf.y = ny;
          break;
        }
      });
    }, WOLF_MOVE_INTERVAL_MS);

    // Slime AI
    this.clock.setInterval(() => {
      this.state.slimes.forEach((slime) => {
        if (!slime.alive) return;
        if (Math.random() > 0.3) return;
        const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const newX = slime.x + dir.dx * TILE_SIZE;
        const newY = slime.y + dir.dy * TILE_SIZE;
        const tx = Math.round(newX / TILE_SIZE), ty = Math.round(newY / TILE_SIZE);
        if (!canWalk(tx, ty)) return;
        if (tx >= 28 && tx <= 44 && ty >= 28 && ty <= 44) return;
        if (NPCS.some(n => n.x === tx && n.y === ty)) return;
        if (this.isTileOccupiedByPlayer(newX, newY, "")) return;
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

      let slimeBlocking = false;
      this.state.slimes.forEach((slime) => {
        if (slime.alive && slime.x === newX && slime.y === newY) slimeBlocking = true;
      });
      if (slimeBlocking) {
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

    console.log(`GameRoom created with ${SLIME_SPAWNS.length} slime spawns`);
  }

  onJoin(client: Client, options: { name?: string; playerClass?: string }) {
    const player = new PlayerState();
    const cls = (options.playerClass === "ranger") ? "ranger" : "warrior";
    const cfg = CLASS_CONFIG[cls];

    player.x = SPAWN_TILE_X * TILE_SIZE;
    player.y = SPAWN_TILE_Y * TILE_SIZE;
    player.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    player.name = options.name || "Anonymous";
    player.direction = "down";
    player.moving = false;
    player.playerClass = cls;
    player.hp = cfg.hpBase;
    player.maxHp = cfg.hpBase;
    player.xp = 0;
    player.level = 1;
    player.attack = cfg.attackBase;
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
