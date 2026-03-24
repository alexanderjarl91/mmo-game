import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";
import { SlimeState } from "./SlimeState";
import { WolfState } from "./WolfState";
import { GoblinState } from "./GoblinState";
import { SkeletonState } from "./SkeletonState";
import { BossState } from "./BossState";
import { InventorySlot } from "./InventorySlot";
import { WORLD_MAP, BLOCKED, MAP_W, MAP_H, NPCS, TILE } from "./tilemap";
import { ITEMS, SHOP_ITEMS, INVENTORY_SIZE, rollLoot } from "./items";
import type { EquipSlot } from "./items";

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
// Protection zone check (temple tiles)
function isProtectionZone(x: number, y: number): boolean {
  const tx = Math.round(x / TILE_SIZE);
  const ty = Math.round(y / TILE_SIZE);
  return WORLD_MAP[ty]?.[tx] === TILE.TEMPLE;
}
const PLAYER_RESPAWN_MS = 5000;
const SPAWN_TILE_X = 36;
const SPAWN_TILE_Y = 43; // Inside the temple
const AUTO_ATTACK_MS = 1200; // auto-attack interval
const MANA_REGEN_MS = 2000; // regen 1 mp every 2s
const MANA_REGEN_AMT = 2;   // mp per tick
const HEAL_COST = 20;       // mana cost
const HEAL_AMOUNT = 30;     // hp restored
const POWER_SHOT_COST = 30; // ranger extra shot
const CLEAVE_COST = 30;     // warrior AoE attack
const POTION_COOLDOWN_MS = 2000;
// Status effect config
const POISON_DURATION_MS = 8000; // 8 seconds
const POISON_TICK_MS = 2000;     // tick every 2s
const POISON_DAMAGE = 5;         // damage per tick
const POISON_CHANCE = 0.25;      // 25% chance on goblin hit
const BURN_DURATION_MS = 6000;   // 6 seconds
const BURN_TICK_MS = 1500;       // tick every 1.5s
const BURN_DAMAGE = 8;           // damage per tick
const BURN_CHANCE = 0.30;        // 30% chance on skeleton hit
const SLIME_GOLD_MIN = 5; const SLIME_GOLD_MAX = 15;
const WOLF_GOLD_MIN = 20; const WOLF_GOLD_MAX = 40;
const PVP_GOLD_MIN = 10; const PVP_GOLD_MAX = 30;

function randRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Inventory helpers
function addToInventory(player: PlayerState, itemId: string, qty: number): boolean {
  for (let i = 0; i < player.inventory.length; i++) {
    const slot = player.inventory.at(i);
    if (!slot) continue;
    if (slot.itemId === itemId) {
      const item = ITEMS[itemId];
      if (item && slot.quantity < item.maxStack) {
        const canAdd = Math.min(qty, item.maxStack - slot.quantity);
        slot.quantity += canAdd;
        qty -= canAdd;
        if (qty <= 0) return true;
      }
    }
  }
  while (qty > 0 && player.inventory.length < INVENTORY_SIZE) {
    const item = ITEMS[itemId];
    if (!item) return false;
    const slot = new InventorySlot();
    slot.itemId = itemId;
    slot.quantity = Math.min(qty, item.maxStack);
    qty -= slot.quantity;
    player.inventory.push(slot);
  }
  return qty <= 0;
}

function removeFromInventory(player: PlayerState, itemId: string, qty: number): boolean {
  let remaining = qty;
  for (let i = player.inventory.length - 1; i >= 0; i--) {
    const slot = player.inventory.at(i);
    if (!slot) continue;
    if (slot.itemId === itemId) {
      if (slot.quantity <= remaining) {
        remaining -= slot.quantity;
        player.inventory.splice(i, 1);
      } else {
        slot.quantity -= remaining;
        remaining = 0;
      }
      if (remaining <= 0) return true;
    }
  }
  return false;
}

function countInInventory(player: PlayerState, itemId: string): number {
  let count = 0;
  for (let i = 0; i < player.inventory.length; i++) {
    const s = player.inventory.at(i);
    if (s && s.itemId === itemId) count += s.quantity;
  }
  return count;
}

// Equipment helpers
function getEquipSlotField(slot: EquipSlot): "equipWeapon" | "equipHelmet" | "equipChest" | "equipLegs" | "equipBoots" {
  switch (slot) {
    case "weapon": return "equipWeapon";
    case "helmet": return "equipHelmet";
    case "chest": return "equipChest";
    case "legs": return "equipLegs";
    case "boots": return "equipBoots";
  }
}

function recalcEquipBonuses(player: PlayerState) {
  const cfg = CLASS_CONFIG[player.playerClass] || CLASS_CONFIG.warrior;
  const level = player.level;
  let bonusAtk = 0, bonusDef = 0, bonusMaxHp = 0, bonusMaxMp = 0;
  const slots = [player.equipWeapon, player.equipHelmet, player.equipChest, player.equipLegs, player.equipBoots];
  for (const itemId of slots) {
    if (!itemId) continue;
    const item = ITEMS[itemId];
    if (!item?.equipBonus) continue;
    bonusAtk += item.equipBonus.atk || 0;
    bonusDef += item.equipBonus.def || 0;
    bonusMaxHp += item.equipBonus.maxHp || 0;
    bonusMaxMp += item.equipBonus.maxMp || 0;
  }
  player.attack = cfg.attackBase + (level - 1) * 5 + bonusAtk;
  player.defense = bonusDef;
  const newMaxHp = cfg.hpBase + (level - 1) * 20 + bonusMaxHp;
  const newMaxMp = cfg.mpBase + (level - 1) * 10 + bonusMaxMp;
  // Don't let current HP/MP exceed new max
  player.maxHp = newMaxHp;
  player.maxMp = newMaxMp;
  if (player.hp > player.maxHp) player.hp = player.maxHp;
  if (player.mp > player.maxMp) player.mp = player.maxMp;
}

function equipItem(player: PlayerState, itemId: string): boolean {
  const item = ITEMS[itemId];
  if (!item || !item.equipSlot) return false;
  const field = getEquipSlotField(item.equipSlot);
  // Unequip current item first
  const currentId = player[field] as string;
  if (currentId) {
    if (!addToInventory(player, currentId, 1)) return false; // inv full
  }
  // Remove new item from inventory
  if (!removeFromInventory(player, itemId, 1)) {
    // Put old item back if we already added it
    if (currentId) removeFromInventory(player, currentId, 1);
    return false;
  }
  player[field] = itemId;
  recalcEquipBonuses(player);
  return true;
}

function unequipItem(player: PlayerState, slot: EquipSlot): boolean {
  const field = getEquipSlotField(slot);
  const currentId = player[field] as string;
  if (!currentId) return false;
  if (!addToInventory(player, currentId, 1)) return false; // inv full
  player[field] = "";
  recalcEquipBonuses(player);
  return true;
}

function applyStatusEffect(player: PlayerState, effect: "poison" | "burn", durationMs: number) {
  player.statusEffect = effect;
  player.statusEffectEnd = Date.now() + durationMs;
}

function applyDefense(rawDamage: number, defense: number): number {
  // Defense reduces damage: dmg * 100 / (100 + defense)
  return Math.max(1, Math.floor(rawDamage * 100 / (100 + defense)));
}

function checkLevelUp(player: PlayerState, room: GameRoom, sessionId: string) {
  const cfg = CLASS_CONFIG[player.playerClass] || CLASS_CONFIG.warrior;
  const newLevel = levelFromXp(player.xp);
  if (newLevel > player.level) {
    player.level = newLevel;
    recalcEquipBonuses(player);
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    room.broadcast("levelup", { sessionId, name: player.name, level: newLevel });
  }
}

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

// Goblin constants
const GOBLIN_HP = 80;
const GOBLIN_ATK = 15;
const GOBLIN_XP = 50;
const GOBLIN_CHASE_RANGE = 6;
const GOBLIN_LEASH_RANGE = 12;
const GOBLIN_MOVE_INTERVAL_MS = 450;
const GOBLIN_ATTACK_INTERVAL_MS = 1400;
const GOBLIN_RESPAWN_MS = 25000;
const GOBLIN_SPAWN_COUNT = 6;
const GOBLIN_GOLD_MIN = 10;
const GOBLIN_GOLD_MAX = 25;

// Skeleton constants
const SKELETON_HP = 200;
const SKELETON_ATK = 30;
const SKELETON_XP = 120;
const SKELETON_CHASE_RANGE = 10;
const SKELETON_LEASH_RANGE = 18;
const SKELETON_MOVE_INTERVAL_MS = 600;
const SKELETON_ATTACK_INTERVAL_MS = 2000;
const SKELETON_RESPAWN_MS = 45000;
const SKELETON_SPAWN_COUNT = 4;
const SKELETON_GOLD_MIN = 30;
const SKELETON_GOLD_MAX = 60;

// Boss constants
const BOSS_HP = 2000;
const BOSS_ATK = 45;
const BOSS_XP = 500;
const BOSS_GOLD_MIN = 200;
const BOSS_GOLD_MAX = 500;
const BOSS_CHASE_RANGE = 12;
const BOSS_LEASH_RANGE = 20;
const BOSS_MOVE_INTERVAL_MS = 700;
const BOSS_ATTACK_INTERVAL_MS = 2500;
const BOSS_RESPAWN_MS = 300000; // 5 minutes
const BOSS_SPAWN_ANNOUNCE_MS = 10000; // announce 10s before spawn
const BOSS_PHASE2_HP_RATIO = 0.4; // enrages at 40% HP
const BOSS_PHASE2_ATK_MULT = 1.5;
const BOSS_AOE_CHANCE = 0.3; // 30% chance for AOE attack
const BOSS_AOE_RANGE = 2; // 2 tiles AOE radius
const BOSS_BURN_CHANCE = 0.5; // 50% chance to burn on hit

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
  @type({ map: GoblinState }) goblins = new MapSchema<GoblinState>();
  @type({ map: SkeletonState }) skeletons = new MapSchema<SkeletonState>();
  @type({ map: BossState }) bosses = new MapSchema<BossState>();
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

  isTileOccupiedByMonster(newX: number, newY: number, excludeSlimeId?: string, excludeWolfId?: string, excludeGoblinId?: string, excludeSkeletonId?: string): boolean {
    for (const [id, slime] of this.state.slimes) {
      if (id === excludeSlimeId || !slime.alive) continue;
      if (slime.x === newX && slime.y === newY) return true;
    }
    for (const [id, wolf] of this.state.wolves) {
      if (id === excludeWolfId || !wolf.alive) continue;
      if (wolf.x === newX && wolf.y === newY) return true;
    }
    for (const [id, goblin] of this.state.goblins) {
      if (id === excludeGoblinId || !goblin.alive) continue;
      if (goblin.x === newX && goblin.y === newY) return true;
    }
    for (const [id, skeleton] of this.state.skeletons) {
      if (id === excludeSkeletonId || !skeleton.alive) continue;
      if (skeleton.x === newX && skeleton.y === newY) return true;
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
    player.level = newLevel;
    recalcEquipBonuses(player);

    player.x = SPAWN_TILE_X * TILE_SIZE;
    player.y = SPAWN_TILE_Y * TILE_SIZE;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    player.direction = "down";
    player.moving = false;
    player.targetId = "";
    player.statusEffect = "";
    player.statusEffectEnd = 0;
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
        // Out of range — keep target, just don't attack yet
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
        player.gold += randRange(SLIME_GOLD_MIN, SLIME_GOLD_MAX);

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

        // Roll loot
        const loot = rollLoot("slime");
        const lootNames: string[] = [];
        for (const drop of loot) {
          if (addToInventory(player, drop.itemId, drop.quantity)) {
            const it = ITEMS[drop.itemId];
            lootNames.push(`${it?.icon || ""} ${it?.name || drop.itemId}${drop.quantity > 1 ? ` x${drop.quantity}` : ""}`);
          }
        }
        if (lootNames.length > 0) {
          client.send("loot_received", { items: lootNames });
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
        player.gold += randRange(WOLF_GOLD_MIN, WOLF_GOLD_MAX);

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

        // Roll loot
        const wolfLoot = rollLoot("wolf");
        const wolfLootNames: string[] = [];
        for (const drop of wolfLoot) {
          if (addToInventory(player, drop.itemId, drop.quantity)) {
            const it = ITEMS[drop.itemId];
            wolfLootNames.push(`${it?.icon || ""} ${it?.name || drop.itemId}${drop.quantity > 1 ? ` x${drop.quantity}` : ""}`);
          }
        }
        if (wolfLootNames.length > 0) {
          client.send("loot_received", { items: wolfLootNames });
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
      // No PvP in protection zone
      if (isProtectionZone(px, py) || isProtectionZone(target.x, target.y)) return;
      const d = dist(px, py, target.x, target.y);
      if (d > cfg.range) {
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
        player.gold += randRange(PVP_GOLD_MIN, PVP_GOLD_MAX);
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

      }
      return;
    }

    // Try goblin target
    const goblin = this.state.goblins.get(player.targetId);
    if (goblin && goblin.alive) {
      const d = dist(px, py, goblin.x, goblin.y);
      if (d > cfg.range) return;
      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      goblin.hp = Math.max(0, goblin.hp - damage);

      if (player.playerClass === "ranger") {
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: goblin.x + TILE_SIZE / 2, toY: goblin.y, attackerId: client.sessionId });
      }
      this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });

      if (goblin.hp <= 0) {
        goblin.alive = false;
        const goblinId = player.targetId;
        player.targetId = "";
        player.xp += GOBLIN_XP;
        player.gold += randRange(GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX);
        const newLevel = levelFromXp(player.xp);
        if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
        const gLoot = rollLoot("goblin");
        const gLootNames: string[] = [];
        for (const drop of gLoot) { if (addToInventory(player, drop.itemId, drop.quantity)) { const it = ITEMS[drop.itemId]; gLootNames.push(`${it?.icon || ""} ${it?.name || drop.itemId}${drop.quantity > 1 ? ` x${drop.quantity}` : ""}`); } }
        if (gLootNames.length > 0) client.send("loot_received", { items: gLootNames });
        this.broadcast("kill", { targetId: goblinId, killerId: client.sessionId, killerName: player.name, xp: GOBLIN_XP });
        this.clock.setTimeout(() => { goblin.x = goblin.spawnX; goblin.y = goblin.spawnY; goblin.hp = GOBLIN_HP; goblin.maxHp = GOBLIN_HP; goblin.targetPlayerId = ""; goblin.alive = true; }, GOBLIN_RESPAWN_MS);
      }
      return;
    }

    // Try skeleton target
    const skeleton = this.state.skeletons.get(player.targetId);
    if (skeleton && skeleton.alive) {
      const d = dist(px, py, skeleton.x, skeleton.y);
      if (d > cfg.range) return;
      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      skeleton.hp = Math.max(0, skeleton.hp - damage);

      if (player.playerClass === "ranger") {
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: skeleton.x + TILE_SIZE / 2, toY: skeleton.y, attackerId: client.sessionId });
      }
      this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });

      if (skeleton.hp <= 0) {
        skeleton.alive = false;
        const skeletonId = player.targetId;
        player.targetId = "";
        player.xp += SKELETON_XP;
        player.gold += randRange(SKELETON_GOLD_MIN, SKELETON_GOLD_MAX);
        const newLevel = levelFromXp(player.xp);
        if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
        const sLoot = rollLoot("skeleton");
        const sLootNames: string[] = [];
        for (const drop of sLoot) { if (addToInventory(player, drop.itemId, drop.quantity)) { const it = ITEMS[drop.itemId]; sLootNames.push(`${it?.icon || ""} ${it?.name || drop.itemId}${drop.quantity > 1 ? ` x${drop.quantity}` : ""}`); } }
        if (sLootNames.length > 0) client.send("loot_received", { items: sLootNames });
        this.broadcast("kill", { targetId: skeletonId, killerId: client.sessionId, killerName: player.name, xp: SKELETON_XP });
        this.clock.setTimeout(() => { skeleton.x = skeleton.spawnX; skeleton.y = skeleton.spawnY; skeleton.hp = SKELETON_HP; skeleton.maxHp = SKELETON_HP; skeleton.targetPlayerId = ""; skeleton.alive = true; }, SKELETON_RESPAWN_MS);
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
          // Don't attack players in protection zone
          if (isProtectionZone(closest.x, closest.y)) return;
          const last = wolfLastAttack.get(wolf.id) || 0;
          if (now - last >= WOLF_ATTACK_INTERVAL_MS) {
            wolfLastAttack.set(wolf.id, now);
            const rawDmg = WOLF_ATK + Math.floor(Math.random() * 8);
            const damage = applyDefense(rawDmg, closest.defense);
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

          // Attack if in range (not in protection zone)
          if (d <= SLIME_ATTACK_RANGE) {
            if (isProtectionZone(target.x, target.y)) return;
            const last = slimeLastAttack.get(slimeId) || 0;
            if (now - last >= SLIME_ATTACK_INTERVAL_MS) {
              slimeLastAttack.set(slimeId, now);
              const rawDmg = SLIME_ATK + Math.floor(Math.random() * 6);
              const damage = applyDefense(rawDmg, target.defense);
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

    // Spawn goblins (in outer grasslands, NE/NW quadrants)
    const goblinSpawns: { x: number; y: number }[] = [];
    for (let attempt = 0; attempt < 300 && goblinSpawns.length < GOBLIN_SPAWN_COUNT; attempt++) {
      const gx = Math.floor(Math.random() * MAP_W);
      const gy = Math.floor(Math.random() * MAP_H);
      if (gx >= 20 && gx <= 48 && gy >= 20 && gy <= 48) continue; // not near village
      if (!canWalk(gx, gy)) continue;
      if (goblinSpawns.some(g => Math.abs(g.x - gx) + Math.abs(g.y - gy) < 3)) continue;
      goblinSpawns.push({ x: gx, y: gy });
    }
    (this as any)._goblinSpawns = goblinSpawns;
    goblinSpawns.forEach((spawn, i) => {
      const goblin = new GoblinState();
      goblin.id = `goblin_${i}`;
      goblin.x = spawn.x * TILE_SIZE;
      goblin.y = spawn.y * TILE_SIZE;
      goblin.spawnX = goblin.x;
      goblin.spawnY = goblin.y;
      const variants = ["normal", "normal", "normal", "archer", "shaman"];
      goblin.variant = variants[i % variants.length];
      goblin.hp = GOBLIN_HP;
      goblin.maxHp = GOBLIN_HP;
      goblin.alive = true;
      this.state.goblins.set(goblin.id, goblin);
    });

    // Spawn skeletons (far edges, dangerous zones)
    const skeletonSpawns: { x: number; y: number }[] = [];
    for (let attempt = 0; attempt < 300 && skeletonSpawns.length < SKELETON_SPAWN_COUNT; attempt++) {
      const sx = Math.floor(Math.random() * MAP_W);
      const sy = Math.floor(Math.random() * MAP_H);
      // Only in outer 12 tiles of map edges (dangerous border zone)
      if (sx >= 12 && sx <= MAP_W - 12 && sy >= 12 && sy <= MAP_H - 12) continue;
      if (!canWalk(sx, sy)) continue;
      if (skeletonSpawns.some(s => Math.abs(s.x - sx) + Math.abs(s.y - sy) < 5)) continue;
      skeletonSpawns.push({ x: sx, y: sy });
    }
    (this as any)._skeletonSpawns = skeletonSpawns;
    skeletonSpawns.forEach((spawn, i) => {
      const skeleton = new SkeletonState();
      skeleton.id = `skeleton_${i}`;
      skeleton.x = spawn.x * TILE_SIZE;
      skeleton.y = spawn.y * TILE_SIZE;
      skeleton.spawnX = skeleton.x;
      skeleton.spawnY = skeleton.y;
      skeleton.hp = SKELETON_HP;
      skeleton.maxHp = SKELETON_HP;
      skeleton.alive = true;
      this.state.skeletons.set(skeleton.id, skeleton);
    });

    // Goblin AI — aggressive, faster than wolves
    const goblinLastAttack = new Map<string, number>();
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.goblins.forEach((goblin) => {
        if (!goblin.alive) return;
        const gtx = Math.round(goblin.x / TILE_SIZE);
        const gty = Math.round(goblin.y / TILE_SIZE);

        let closest: PlayerState | null = null;
        let closestSid = "";
        let closestDist = Infinity;
        this.state.players.forEach((p, sid) => {
          if (p.hp <= 0) return;
          const d = Math.max(Math.abs(Math.round(p.x / TILE_SIZE) - gtx), Math.abs(Math.round(p.y / TILE_SIZE) - gty));
          if (d <= GOBLIN_CHASE_RANGE && d < closestDist) {
            closest = p; closestSid = sid; closestDist = d;
          }
        });

        if (!closest && goblin.targetPlayerId) {
          const tracked = this.state.players.get(goblin.targetPlayerId);
          if (tracked && tracked.hp > 0) {
            const d = Math.max(Math.abs(Math.round(tracked.x / TILE_SIZE) - gtx), Math.abs(Math.round(tracked.y / TILE_SIZE) - gty));
            if (d <= GOBLIN_LEASH_RANGE) { closest = tracked; closestSid = goblin.targetPlayerId; closestDist = d; }
          }
        }

        if (!closest) {
          goblin.targetPlayerId = "";
          if (Math.random() > 0.4) return;
          const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          const dir = dirs[Math.floor(Math.random() * dirs.length)];
          const nx = goblin.x + dir.dx * TILE_SIZE, ny = goblin.y + dir.dy * TILE_SIZE;
          const ntx = Math.round(nx / TILE_SIZE), nty = Math.round(ny / TILE_SIZE);
          if (!canWalk(ntx, nty)) return;
          if (ntx >= 28 && ntx <= 44 && nty >= 28 && nty <= 44) return;
          goblin.x = nx; goblin.y = ny;
          return;
        }

        goblin.targetPlayerId = closestSid;

        if (closestDist <= 1) {
          if (isProtectionZone(closest.x, closest.y)) return;
          const last = goblinLastAttack.get(goblin.id) || 0;
          if (now - last >= GOBLIN_ATTACK_INTERVAL_MS) {
            goblinLastAttack.set(goblin.id, now);
            const rawDmg = GOBLIN_ATK + Math.floor(Math.random() * 8);
            const damage = applyDefense(rawDmg, closest.defense);
            closest.hp = Math.max(0, closest.hp - damage);
            this.broadcast("hit", { targetId: closestSid, damage, x: closest.x + TILE_SIZE / 2, y: closest.y, attackerId: goblin.id });
            // Goblins apply poison
            if (Math.random() < POISON_CHANCE) {
              applyStatusEffect(closest, "poison", POISON_DURATION_MS);
              this.broadcast("status_applied", { sessionId: closestSid, effect: "poison" });
            }
            if (closest.hp <= 0) {
              goblin.targetPlayerId = "";
              closest.statusEffect = ""; closest.statusEffectEnd = 0;
              this.broadcast("kill", { targetId: closestSid, killerId: goblin.id, killerName: "Goblin", xp: 0 });
            }
          }
          return;
        }

        const ptx = Math.round(closest.x / TILE_SIZE), pty = Math.round(closest.y / TILE_SIZE);
        const step = bfsNextStep(gtx, gty, ptx, pty, GOBLIN_LEASH_RANGE);
        if (step && !this.isTileOccupiedByMonster(step.x * TILE_SIZE, step.y * TILE_SIZE, undefined, undefined, goblin.id)) {
          goblin.x = step.x * TILE_SIZE; goblin.y = step.y * TILE_SIZE;
        }
      });
    }, GOBLIN_MOVE_INTERVAL_MS);

    // Skeleton AI — slow but deadly, high range
    const skeletonLastAttack = new Map<string, number>();
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.skeletons.forEach((skeleton) => {
        if (!skeleton.alive) return;
        const stx = Math.round(skeleton.x / TILE_SIZE);
        const sty = Math.round(skeleton.y / TILE_SIZE);

        let closest: PlayerState | null = null;
        let closestSid = "";
        let closestDist = Infinity;
        this.state.players.forEach((p, sid) => {
          if (p.hp <= 0) return;
          const d = Math.max(Math.abs(Math.round(p.x / TILE_SIZE) - stx), Math.abs(Math.round(p.y / TILE_SIZE) - sty));
          if (d <= SKELETON_CHASE_RANGE && d < closestDist) {
            closest = p; closestSid = sid; closestDist = d;
          }
        });

        if (!closest && skeleton.targetPlayerId) {
          const tracked = this.state.players.get(skeleton.targetPlayerId);
          if (tracked && tracked.hp > 0) {
            const d = Math.max(Math.abs(Math.round(tracked.x / TILE_SIZE) - stx), Math.abs(Math.round(tracked.y / TILE_SIZE) - sty));
            if (d <= SKELETON_LEASH_RANGE) { closest = tracked; closestSid = skeleton.targetPlayerId; closestDist = d; }
          }
        }

        if (!closest) {
          skeleton.targetPlayerId = "";
          if (Math.random() > 0.2) return;
          const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          const dir = dirs[Math.floor(Math.random() * dirs.length)];
          const nx = skeleton.x + dir.dx * TILE_SIZE, ny = skeleton.y + dir.dy * TILE_SIZE;
          const ntx = Math.round(nx / TILE_SIZE), nty = Math.round(ny / TILE_SIZE);
          if (!canWalk(ntx, nty)) return;
          skeleton.x = nx; skeleton.y = ny;
          return;
        }

        skeleton.targetPlayerId = closestSid;

        if (closestDist <= 1) {
          if (isProtectionZone(closest.x, closest.y)) return;
          const last = skeletonLastAttack.get(skeleton.id) || 0;
          if (now - last >= SKELETON_ATTACK_INTERVAL_MS) {
            skeletonLastAttack.set(skeleton.id, now);
            const rawDmg = SKELETON_ATK + Math.floor(Math.random() * 12);
            const damage = applyDefense(rawDmg, closest.defense);
            closest.hp = Math.max(0, closest.hp - damage);
            this.broadcast("hit", { targetId: closestSid, damage, x: closest.x + TILE_SIZE / 2, y: closest.y, attackerId: skeleton.id });
            // Skeletons apply burn
            if (Math.random() < BURN_CHANCE) {
              applyStatusEffect(closest, "burn", BURN_DURATION_MS);
              this.broadcast("status_applied", { sessionId: closestSid, effect: "burn" });
            }
            if (closest.hp <= 0) {
              skeleton.targetPlayerId = "";
              closest.statusEffect = ""; closest.statusEffectEnd = 0;
              this.broadcast("kill", { targetId: closestSid, killerId: skeleton.id, killerName: "Skeleton", xp: 0 });
            }
          }
          return;
        }

        const ptx = Math.round(closest.x / TILE_SIZE), pty = Math.round(closest.y / TILE_SIZE);
        const step = bfsNextStep(stx, sty, ptx, pty, SKELETON_LEASH_RANGE);
        if (step && !this.isTileOccupiedByMonster(step.x * TILE_SIZE, step.y * TILE_SIZE, undefined, undefined, undefined, skeleton.id)) {
          skeleton.x = step.x * TILE_SIZE; skeleton.y = step.y * TILE_SIZE;
        }
      });
    }, SKELETON_MOVE_INTERVAL_MS);

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

    // Mana regen tick (+ temple fast regen)
    this.clock.setInterval(() => {
      this.state.players.forEach((player) => {
        if (player.hp <= 0) return;
        // Check if player is on a temple tile
        const tileX = Math.round(player.x / TILE_SIZE);
        const tileY = Math.round(player.y / TILE_SIZE);
        const onTemple = WORLD_MAP[tileY]?.[tileX] === TILE.TEMPLE;
        const regenMult = onTemple ? 10 : 1; // 10x regen in temple

        if (player.mp < player.maxMp) {
          player.mp = Math.min(player.maxMp, player.mp + MANA_REGEN_AMT * regenMult);
        }
        if (onTemple && player.hp < player.maxHp) {
          player.hp = Math.min(player.maxHp, player.hp + 5 * regenMult); // 50 HP/tick in temple
        }
      });
    }, MANA_REGEN_MS);

    // Status effect DOT tick
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.players.forEach((player, sid) => {
        if (player.hp <= 0 || !player.statusEffect) return;
        // Check if effect expired
        if (now >= player.statusEffectEnd) {
          player.statusEffect = "";
          player.statusEffectEnd = 0;
          return;
        }
        // Apply DOT damage
        let dotDmg = 0;
        if (player.statusEffect === "poison") dotDmg = POISON_DAMAGE;
        else if (player.statusEffect === "burn") dotDmg = BURN_DAMAGE;
        if (dotDmg > 0) {
          player.hp = Math.max(0, player.hp - dotDmg);
          this.broadcast("status_tick", { sessionId: sid, effect: player.statusEffect, damage: dotDmg });
          if (player.hp <= 0) {
            player.statusEffect = "";
            player.statusEffectEnd = 0;
            this.broadcast("kill", { targetId: sid, killerId: player.statusEffect === "poison" ? "poison" : "burn", killerName: player.statusEffect === "poison" ? "Poison" : "Fire", xp: 0 });
          }
        }
      });
    }, 1500); // tick every 1.5s

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
      // Allow player overlap in protection zone (temple)
      const destTx = Math.round(newX / TILE_SIZE);
      const destTy = Math.round(newY / TILE_SIZE);
      const destIsTemple = WORLD_MAP[destTy]?.[destTx] === TILE.TEMPLE;
      if (!destIsTemple && this.isTileOccupiedByPlayer(newX, newY, client.sessionId)) {
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
      this.state.goblins.forEach((goblin) => {
        if (goblin.alive && goblin.x === newX && goblin.y === newY) monsterBlocking = true;
      });
      this.state.skeletons.forEach((skeleton) => {
        if (skeleton.alive && skeleton.x === newX && skeleton.y === newY) monsterBlocking = true;
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
        const goblin = this.state.goblins.get(tid);
        const skeleton = this.state.skeletons.get(tid);
        const targetPlayer = this.state.players.get(tid);
        const valid = (slime && slime.alive) || (wolf && wolf.alive) || (goblin && goblin.alive) || (skeleton && skeleton.alive) || (targetPlayer && targetPlayer.hp > 0 && tid !== client.sessionId);
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
    // ── Respawn (player clicks button after dying) ──
    this.onMessage("request_respawn", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return; // only if dead
      if (player.isHardcore) return; // hardcore characters can't respawn
      this.respawnPlayer(player);
    });

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

    // ── Use Potion ──
    const potionCooldowns = new Map<string, number>();
    this.onMessage("use_potion", (client, data: { itemId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const itemId = data.itemId;
      const item = ITEMS[itemId];
      if (!item || item.type !== "consumable") return;
      if (countInInventory(player, itemId) <= 0) return;

      // Cooldown check
      const now = Date.now();
      const lastUse = potionCooldowns.get(client.sessionId) || 0;
      if (now - lastUse < POTION_COOLDOWN_MS) return;
      potionCooldowns.set(client.sessionId, now);

      // Don't waste potions at full
      if (item.effect?.hp && player.hp >= player.maxHp) return;
      if (item.effect?.mp && player.mp >= player.maxMp) return;

      removeFromInventory(player, itemId, 1);

      if (item.effect?.hp) {
        const healed = Math.min(item.effect.hp, player.maxHp - player.hp);
        player.hp += healed;
        this.broadcast("heal_effect", { sessionId: client.sessionId, amount: healed });
      }
      if (item.effect?.mp) {
        const restored = Math.min(item.effect.mp, player.maxMp - player.mp);
        player.mp += restored;
        this.broadcast("mana_effect", { sessionId: client.sessionId, amount: restored });
      }
    });

    // ── Shop Buy ──
    this.onMessage("shop_buy", (client, data: { itemId: string; quantity: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const item = ITEMS[data.itemId];
      if (!item || !SHOP_ITEMS.includes(data.itemId)) return;
      const qty = Math.max(1, Math.min(data.quantity || 1, 50));
      const cost = item.buyPrice * qty;
      if (player.gold < cost) return;
      if (!addToInventory(player, data.itemId, qty)) return; // inventory full
      player.gold -= cost;
    });

    // ── Shop Sell ──
    this.onMessage("shop_sell", (client, data: { itemId: string; quantity: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const item = ITEMS[data.itemId];
      if (!item || item.sellPrice <= 0) return;
      const qty = Math.max(1, Math.min(data.quantity || 1, countInInventory(player, data.itemId)));
      if (qty <= 0) return;
      if (!removeFromInventory(player, data.itemId, qty)) return;
      player.gold += item.sellPrice * qty;
    });

    // ── Equip item ──
    this.onMessage("equip_item", (client, data: { itemId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const item = ITEMS[data.itemId];
      if (!item || !item.equipSlot) return;
      if (countInInventory(player, data.itemId) <= 0) return;
      equipItem(player, data.itemId);
    });

    // ── Unequip item ──
    this.onMessage("unequip_item", (client, data: { slot: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const validSlots = ["weapon", "helmet", "chest", "legs", "boots"];
      if (!validSlots.includes(data.slot)) return;
      unequipItem(player, data.slot as EquipSlot);
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
          player.gold += randRange(WOLF_GOLD_MIN, WOLF_GOLD_MAX);
          const newLevel = levelFromXp(player.xp);
          if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
          this.broadcast("kill", { targetId: player.targetId, killerId: client.sessionId, killerName: player.name, xp: WOLF_XP });
          this.clock.setTimeout(() => { wolf.x = wolf.spawnX; wolf.y = wolf.spawnY; wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP; wolf.targetPlayerId = ""; wolf.alive = true; }, WOLF_RESPAWN_MS);
        }
        return;
      }

      // Check goblin target
      const goblinT = this.state.goblins.get(player.targetId);
      if (goblinT && goblinT.alive) {
        const d = dist(px, py, goblinT.x, goblinT.y);
        if (d > cfg.range) return;
        player.mp -= POWER_SHOT_COST;
        const damage = Math.max(1, Math.floor(player.attack * 1.5) + Math.floor(Math.random() * 10) - 5);
        goblinT.hp = Math.max(0, goblinT.hp - damage);
        goblinT.targetPlayerId = client.sessionId;
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: goblinT.x + TILE_SIZE / 2, toY: goblinT.y });
        this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });
        if (goblinT.hp <= 0) {
          goblinT.alive = false; goblinT.targetPlayerId = ""; player.targetId = "";
          player.xp += GOBLIN_XP; player.gold += randRange(GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX);
          const loot = rollLoot("goblin"); for (const drop of loot) addToInventory(player, drop.itemId, drop.quantity);
          checkLevelUp(player, this, client.sessionId);
          this.broadcast("kill", { targetId: player.targetId, killerId: client.sessionId, killerName: player.name, xp: GOBLIN_XP });
          this.clock.setTimeout(() => { goblinT.x = goblinT.spawnX; goblinT.y = goblinT.spawnY; goblinT.hp = GOBLIN_HP; goblinT.maxHp = GOBLIN_HP; goblinT.targetPlayerId = ""; goblinT.alive = true; }, GOBLIN_RESPAWN_MS);
        }
        return;
      }

      // Check skeleton target
      const skelT = this.state.skeletons.get(player.targetId);
      if (skelT && skelT.alive) {
        const d = dist(px, py, skelT.x, skelT.y);
        if (d > cfg.range) return;
        player.mp -= POWER_SHOT_COST;
        const damage = Math.max(1, Math.floor(player.attack * 1.5) + Math.floor(Math.random() * 10) - 5);
        skelT.hp = Math.max(0, skelT.hp - damage);
        skelT.targetPlayerId = client.sessionId;
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: skelT.x + TILE_SIZE / 2, toY: skelT.y });
        this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });
        if (skelT.hp <= 0) {
          skelT.alive = false; skelT.targetPlayerId = ""; player.targetId = "";
          player.xp += SKELETON_XP; player.gold += randRange(SKELETON_GOLD_MIN, SKELETON_GOLD_MAX);
          const loot = rollLoot("skeleton"); for (const drop of loot) addToInventory(player, drop.itemId, drop.quantity);
          checkLevelUp(player, this, client.sessionId);
          this.broadcast("kill", { targetId: player.targetId, killerId: client.sessionId, killerName: player.name, xp: SKELETON_XP });
          this.clock.setTimeout(() => { skelT.x = skelT.spawnX; skelT.y = skelT.spawnY; skelT.hp = SKELETON_HP; skelT.maxHp = SKELETON_HP; skelT.targetPlayerId = ""; skelT.alive = true; }, SKELETON_RESPAWN_MS);
        }
        return;
      }

      // Check player target (PvP) — no PvP in protection zone
      const target = this.state.players.get(player.targetId);
      if (target && target.hp > 0) {
        if (isProtectionZone(px, py) || isProtectionZone(target.x, target.y)) return;
        const d = dist(px, py, target.x, target.y);
        if (d > cfg.range) return;
        player.mp -= POWER_SHOT_COST;
        const damage = Math.max(1, Math.floor(player.attack * 1.5) + Math.floor(Math.random() * 10) - 5);
        target.hp = Math.max(0, target.hp - damage);
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: target.x + TILE_SIZE / 2, toY: target.y });
        this.broadcast("pvp_hit", { targetId: player.targetId, attackerName: player.name, damage });
        if (target.hp <= 0) { player.targetId = ""; const xpGain = 50 + target.level * 10; player.xp += xpGain; this.broadcast("pvp_kill", { killerName: player.name, targetName: target.name, xp: xpGain }); }
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
          player.gold += randRange(WOLF_GOLD_MIN, WOLF_GOLD_MAX);
          this.broadcast("kill", { targetId: wolfId, killerId: client.sessionId, killerName: player.name, xp: WOLF_XP });
          this.clock.setTimeout(() => { wolf.x = wolf.spawnX; wolf.y = wolf.spawnY; wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP; wolf.targetPlayerId = ""; wolf.alive = true; }, WOLF_RESPAWN_MS);
        }
      });

      // Hit all adjacent goblins
      this.state.goblins.forEach((goblin, goblinId) => {
        if (!goblin.alive) return;
        const d = dist(px, py, goblin.x, goblin.y);
        if (d > 1) return;
        const damage = Math.max(1, Math.floor(player.attack * 1.2) + Math.floor(Math.random() * 10) - 5);
        goblin.hp = Math.max(0, goblin.hp - damage);
        goblin.targetPlayerId = client.sessionId;
        this.broadcast("hit", { targetId: goblinId, damage, attackerId: client.sessionId });
        hitCount++;
        if (goblin.hp <= 0) {
          goblin.alive = false; goblin.targetPlayerId = "";
          if (player.targetId === goblinId) player.targetId = "";
          player.xp += GOBLIN_XP; player.gold += randRange(GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX);
          this.broadcast("kill", { targetId: goblinId, killerId: client.sessionId, killerName: player.name, xp: GOBLIN_XP });
          this.clock.setTimeout(() => { goblin.x = goblin.spawnX; goblin.y = goblin.spawnY; goblin.hp = GOBLIN_HP; goblin.maxHp = GOBLIN_HP; goblin.targetPlayerId = ""; goblin.alive = true; }, GOBLIN_RESPAWN_MS);
        }
      });

      // Hit all adjacent skeletons
      this.state.skeletons.forEach((skeleton, skeletonId) => {
        if (!skeleton.alive) return;
        const d = dist(px, py, skeleton.x, skeleton.y);
        if (d > 1) return;
        const damage = Math.max(1, Math.floor(player.attack * 1.2) + Math.floor(Math.random() * 10) - 5);
        skeleton.hp = Math.max(0, skeleton.hp - damage);
        skeleton.targetPlayerId = client.sessionId;
        this.broadcast("hit", { targetId: skeletonId, damage, attackerId: client.sessionId });
        hitCount++;
        if (skeleton.hp <= 0) {
          skeleton.alive = false; skeleton.targetPlayerId = "";
          if (player.targetId === skeletonId) player.targetId = "";
          player.xp += SKELETON_XP; player.gold += randRange(SKELETON_GOLD_MIN, SKELETON_GOLD_MAX);
          this.broadcast("kill", { targetId: skeletonId, killerId: client.sessionId, killerName: player.name, xp: SKELETON_XP });
          this.clock.setTimeout(() => { skeleton.x = skeleton.spawnX; skeleton.y = skeleton.spawnY; skeleton.hp = SKELETON_HP; skeleton.maxHp = SKELETON_HP; skeleton.targetPlayerId = ""; skeleton.alive = true; }, SKELETON_RESPAWN_MS);
        }
      });

      // Hit all adjacent players (no PvP in protection zone)
      if (!isProtectionZone(px, py)) this.state.players.forEach((target, sid) => {
        if (sid === client.sessionId || target.hp <= 0) return;
        if (isProtectionZone(target.x, target.y)) return;
        const d = dist(px, py, target.x, target.y);
        if (d > 1) return;
        const damage = Math.max(1, Math.floor(player.attack * 1.2) + Math.floor(Math.random() * 10) - 5);
        target.hp = Math.max(0, target.hp - damage);
        this.broadcast("pvp_hit", { targetId: sid, attackerName: player.name, damage });
        hitCount++;
        if (target.hp <= 0) { if (player.targetId === sid) player.targetId = ""; const xpGain = 50 + target.level * 10; player.xp += xpGain; this.broadcast("pvp_kill", { killerName: player.name, targetName: target.name, xp: xpGain }); }
      });

      // Check for level up
      const newLevel = levelFromXp(player.xp);
      if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }

      // Broadcast cleave visual
      this.broadcast("cleave_effect", { sessionId: client.sessionId, x: px, y: py, hits: hitCount });
    });

    console.log(`GameRoom created with ${SLIME_SPAWNS.length} slime spawns`);
  }

  onJoin(client: Client, options: { name?: string; playerClass?: string; savedXp?: number; isHardcore?: boolean; savedGold?: number; savedInventory?: Array<{itemId: string; quantity: number}>; savedEquipment?: Record<string, string> }) {
    const player = new PlayerState();
    const cls = (options.playerClass === "ranger") ? "ranger" : "warrior";
    const cfg = CLASS_CONFIG[cls];
    player.isHardcore = !!options.isHardcore;

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
    player.xp = xp;
    player.level = level;
    player.targetId = "";
    player.gold = Math.max(0, Math.min(options.savedGold || 0, 10000000));

    // Restore inventory
    if (options.savedInventory && Array.isArray(options.savedInventory)) {
      for (const slot of options.savedInventory) {
        if (slot.itemId && ITEMS[slot.itemId] && slot.quantity > 0) {
          addToInventory(player, slot.itemId, Math.min(slot.quantity, ITEMS[slot.itemId].maxStack));
        }
      }
    }

    // Restore equipment
    if (options.savedEquipment) {
      const eq = options.savedEquipment;
      if (eq.weapon && ITEMS[eq.weapon]?.equipSlot === "weapon") player.equipWeapon = eq.weapon;
      if (eq.helmet && ITEMS[eq.helmet]?.equipSlot === "helmet") player.equipHelmet = eq.helmet;
      if (eq.chest && ITEMS[eq.chest]?.equipSlot === "chest") player.equipChest = eq.chest;
      if (eq.legs && ITEMS[eq.legs]?.equipSlot === "legs") player.equipLegs = eq.legs;
      if (eq.boots && ITEMS[eq.boots]?.equipSlot === "boots") player.equipBoots = eq.boots;
    }

    // Calculate stats with equipment bonuses
    recalcEquipBonuses(player);
    player.hp = player.maxHp;
    player.mp = player.maxMp;

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
