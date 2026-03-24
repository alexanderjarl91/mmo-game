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
import { QuestSlot } from "./QuestSlot";
import { QUESTS, getAvailableQuests, getTurnInQuests } from "./quests";
import { DroppedItem } from "./DroppedItem";
import { WorldEventState } from "./WorldEventState";

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
// Ability cooldowns & costs
const SHIELD_WALL_COST = 40;
const SHIELD_WALL_DURATION_MS = 6000;
const SHIELD_WALL_COOLDOWN_MS = 20000;
const SHIELD_WALL_REDUCTION = 0.5; // 50% damage reduction

const WAR_CRY_COST = 35;
const WAR_CRY_DURATION_MS = 10000;
const WAR_CRY_COOLDOWN_MS = 25000;
const WAR_CRY_ATK_BONUS = 0.5; // +50% attack
const WAR_CRY_RANGE = 3; // tiles — allies within this range also get buffed

const FROST_ARROW_COST = 25;
const FROST_ARROW_DURATION_MS = 4000;
const FROST_ARROW_COOLDOWN_MS = 12000;
const FROST_ARROW_DAMAGE_MULT = 0.8; // 80% of normal attack

const RAIN_OF_ARROWS_COST = 45;
const RAIN_OF_ARROWS_COOLDOWN_MS = 18000;
const RAIN_OF_ARROWS_RANGE = 3; // tiles AOE radius
const RAIN_OF_ARROWS_DAMAGE_MULT = 0.6; // 60% of normal attack per hit

// Ability cooldown tracking (per session, per ability)
const abilityCooldowns = new Map<string, Map<string, number>>();

function getAbilityCooldown(sessionId: string, ability: string): number {
  const map = abilityCooldowns.get(sessionId);
  if (!map) return 0;
  return map.get(ability) || 0;
}

function setAbilityCooldown(sessionId: string, ability: string, until: number) {
  if (!abilityCooldowns.has(sessionId)) abilityCooldowns.set(sessionId, new Map());
  abilityCooldowns.get(sessionId)!.set(ability, until);
}

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
  player.attack = cfg.attackBase + (level - 1) * 5 + bonusAtk + player.buffWarCryAtk;
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

function applyDefense(rawDamage: number, defense: number, player?: PlayerState): number {
  // Defense reduces damage: dmg * 100 / (100 + defense)
  let dmg = Math.max(1, Math.floor(rawDamage * 100 / (100 + defense)));
  // Shield Wall reduction
  if (player && player.buffShieldWallEnd > Date.now()) {
    dmg = Math.max(1, Math.floor(dmg * (1 - SHIELD_WALL_REDUCTION)));
  }
  return dmg;
}

function updateQuestProgress(player: PlayerState, monsterType: string, room: GameRoom, sessionId: string) {
  for (let i = 0; i < player.quests.length; i++) {
    const q = player.quests.at(i);
    if (!q || q.completed || q.turnedIn) continue;
    const def = QUESTS[q.questId];
    if (!def) continue;
    if (def.killTarget === monsterType) {
      q.progress = Math.min(q.progress + 1, q.required);
      if (q.progress >= q.required) {
        q.completed = true;
        // Notify the player
        const client = room.clients.find(c => c.sessionId === sessionId);
        if (client) {
          client.send("quest_complete_ready", { questId: q.questId, questName: def.name, npcId: def.npcId });
          room.sendQuestMarkers(client, player);
        }
        room.broadcast("quest_progress", { sessionId, questId: q.questId, progress: q.progress, required: q.required, completed: true });
      } else {
        const client = room.clients.find(c => c.sessionId === sessionId);
        if (client) {
          client.send("quest_progress", { questId: q.questId, progress: q.progress, required: q.required, completed: false, questName: def.name });
        }
      }
    }
  }
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

// World Event constants
const WORLD_EVENT_MIN_INTERVAL_MS = 120000; // 2 minutes minimum between events
const WORLD_EVENT_MAX_INTERVAL_MS = 300000; // 5 minutes maximum
const TREASURE_CHEST_DURATION_MS = 60000; // 60 seconds to find it
const MANA_SHRINE_DURATION_MS = 45000; // 45 seconds active
const XP_ORB_DURATION_MS = 30000; // 30 seconds to grab it
const GOLDEN_SLIME_DURATION_MS = 90000; // 90 seconds before it escapes
const GOLDEN_SLIME_HP = 500;
const GOLDEN_SLIME_XP = 300;
const GOLDEN_SLIME_ATK = 5; // weak attack - it tries to run
const GOLDEN_SLIME_GOLD_MIN = 200;
const GOLDEN_SLIME_GOLD_MAX = 500;
const TREASURE_CHEST_GOLD_MIN = 100;
const TREASURE_CHEST_GOLD_MAX = 300;
const XP_ORB_XP = 150;
const MANA_SHRINE_RANGE = 2; // tiles — heals players within range
let worldEventCounter = 0;

// Kill streak thresholds
const STREAK_MILESTONES: Array<{ kills: number; title: string; xpBonus: number; goldBonus: number }> = [
  { kills: 3, title: "🔥 Killing Spree", xpBonus: 25, goldBonus: 10 },
  { kills: 5, title: "⚡ Rampage", xpBonus: 50, goldBonus: 25 },
  { kills: 8, title: "💀 Unstoppable", xpBonus: 100, goldBonus: 50 },
  { kills: 12, title: "☠️ Godlike", xpBonus: 200, goldBonus: 100 },
  { kills: 20, title: "👑 Legendary", xpBonus: 500, goldBonus: 250 },
];

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
  @type({ map: DroppedItem }) droppedItems = new MapSchema<DroppedItem>();
  @type({ map: WorldEventState }) worldEvents = new MapSchema<WorldEventState>();
}

// Ground loot config
const DROPPED_ITEM_LIFETIME_MS = 60000; // items despawn after 60 seconds
const LOOT_PROTECTION_MS = 5000; // only killer can loot for 5 seconds
let droppedItemCounter = 0;

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

  // Send quest marker updates to a specific client
  sendQuestMarkers(client: Client, player: PlayerState) {
    const activeQuestIds = new Set<string>();
    const activeQuestMap = new Map<string, { progress: number }>();
    for (let i = 0; i < player.quests.length; i++) {
      const q = player.quests.at(i);
      if (q && !q.turnedIn) {
        activeQuestIds.add(q.questId);
        activeQuestMap.set(q.questId, { progress: q.progress });
      }
    }

    const questNpcs = ["elder", "innkeeper", "blacksmith", "merchant", "fisherman"];
    const markers: Record<string, string> = {};
    
    // First check turn-ins (? markers)
    for (const npcId of questNpcs) {
      const turnIn = getTurnInQuests(npcId, activeQuestMap);
      if (turnIn.length > 0) {
        markers[npcId] = "turnin";
      }
    }
    
    // Then check available quests (! markers) — only if no turn-in
    for (const npcId of questNpcs) {
      if (markers[npcId]) continue;
      const available = getAvailableQuests(npcId, player.level, player.completedQuestIds, activeQuestIds);
      if (available.length > 0) {
        markers[npcId] = "available";
      }
    }

    client.send("npc_quest_markers", markers);
  }

  // Spawn ground loot at a position
  spawnGroundLoot(x: number, y: number, lootTable: string, ownerSessionId: string, goldAmount?: number) {
    // Roll loot from table
    const drops = rollLoot(lootTable);
    
    // Spawn gold as a ground item
    if (goldAmount && goldAmount > 0) {
      const id = `drop_${droppedItemCounter++}`;
      const item = new DroppedItem();
      item.id = id;
      item.itemId = "gold";
      item.quantity = goldAmount;
      item.x = x;
      item.y = y;
      item.droppedAt = Date.now();
      item.ownerSessionId = ownerSessionId;
      this.state.droppedItems.set(id, item);
      
      // Schedule despawn
      this.clock.setTimeout(() => {
        this.state.droppedItems.delete(id);
      }, DROPPED_ITEM_LIFETIME_MS);
    }
    
    // Spawn each item drop
    for (const drop of drops) {
      const id = `drop_${droppedItemCounter++}`;
      const item = new DroppedItem();
      item.id = id;
      item.itemId = drop.itemId;
      item.quantity = drop.quantity;
      // Slight offset so items don't stack exactly
      item.x = x + (Math.random() - 0.5) * TILE_SIZE * 0.5;
      item.y = y + (Math.random() - 0.5) * TILE_SIZE * 0.5;
      item.droppedAt = Date.now();
      item.ownerSessionId = ownerSessionId;
      this.state.droppedItems.set(id, item);
      
      this.clock.setTimeout(() => {
        this.state.droppedItems.delete(id);
      }, DROPPED_ITEM_LIFETIME_MS);
    }
    
    return drops;
  }

  // Broadcast a kill event and auto-update quest progress for the killer
  broadcastKillAndQuest(data: { targetId: string; killerId: string; killerName: string; xp: number }) {
    this.broadcast("kill", data);
    // Only update quests for player kills (not monster-on-player kills)
    const player = this.state.players.get(data.killerId);
    if (!player) return;
    // Determine monster type from targetId prefix
    const tid = data.targetId;
    let monsterType = "";
    if (tid.startsWith("slime_")) monsterType = "slime";
    else if (tid.startsWith("wolf_")) monsterType = "wolf";
    else if (tid.startsWith("goblin_")) monsterType = "goblin";
    else if (tid.startsWith("skeleton_")) monsterType = "skeleton";
    else if (tid.startsWith("boss_")) monsterType = "boss";
    if (monsterType) {
      updateQuestProgress(player, monsterType, this, data.killerId);
    }

    // Kill streak tracking
    player.killStreak++;
    if (player.killStreak > player.bestKillStreak) {
      player.bestKillStreak = player.killStreak;
    }
    // Check for milestone
    for (const ms of STREAK_MILESTONES) {
      if (player.killStreak === ms.kills) {
        player.xp += ms.xpBonus;
        player.gold += ms.goldBonus;
        checkLevelUp(player, this, data.killerId);
        this.broadcast("kill_streak", {
          sessionId: data.killerId,
          name: player.name,
          streak: player.killStreak,
          title: ms.title,
          xpBonus: ms.xpBonus,
          goldBonus: ms.goldBonus,
        });
        break;
      }
    }
  }

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
    // Reset kill streak on death
    if (player.killStreak >= 3) {
      this.broadcast("streak_ended", {
        name: player.name,
        streak: player.killStreak,
      });
    }
    player.killStreak = 0;
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

        // Drop loot on ground
        this.spawnGroundLoot(slime.x, slime.y, "slime", client.sessionId, randRange(SLIME_GOLD_MIN, SLIME_GOLD_MAX));

        this.broadcastKillAndQuest({ targetId: `slime_${sIdx}`, killerId: client.sessionId, killerName: player.name, xp: xpGain });

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

        // Drop loot on ground
        this.spawnGroundLoot(wolf.x, wolf.y, "wolf", client.sessionId, randRange(WOLF_GOLD_MIN, WOLF_GOLD_MAX));

        this.broadcastKillAndQuest( { targetId: wolfId, killerId: client.sessionId, killerName: player.name, xp: xpGain });

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
        const newLevel = levelFromXp(player.xp);
        if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
        this.spawnGroundLoot(goblin.x, goblin.y, "goblin", client.sessionId, randRange(GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX));
        this.broadcastKillAndQuest( { targetId: goblinId, killerId: client.sessionId, killerName: player.name, xp: GOBLIN_XP });
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
        const newLevel = levelFromXp(player.xp);
        if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
        this.spawnGroundLoot(skeleton.x, skeleton.y, "skeleton", client.sessionId, randRange(SKELETON_GOLD_MIN, SKELETON_GOLD_MAX));
        this.broadcastKillAndQuest( { targetId: skeletonId, killerId: client.sessionId, killerName: player.name, xp: SKELETON_XP });
        this.clock.setTimeout(() => { skeleton.x = skeleton.spawnX; skeleton.y = skeleton.spawnY; skeleton.hp = SKELETON_HP; skeleton.maxHp = SKELETON_HP; skeleton.targetPlayerId = ""; skeleton.alive = true; }, SKELETON_RESPAWN_MS);
      }
      return;
    }

    // Try boss target
    const boss = this.state.bosses.get(player.targetId);
    if (boss && boss.alive) {
      const d = dist(px, py, boss.x, boss.y);
      if (d > cfg.range) return;
      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      boss.hp = Math.max(0, boss.hp - damage);

      if (player.playerClass === "ranger") {
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: boss.x + TILE_SIZE / 2, toY: boss.y, attackerId: client.sessionId });
      }
      this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });

      // Phase change at 40% HP
      if (boss.hp > 0 && boss.hp <= boss.maxHp * BOSS_PHASE2_HP_RATIO && boss.phase === 1) {
        boss.phase = 2;
        this.broadcast("boss_enrage", { bossId: boss.id, bossType: boss.bossType });
      }

      if (boss.hp <= 0) {
        boss.alive = false;
        const bossId = player.targetId;
        player.targetId = "";
        player.xp += BOSS_XP;
        this.spawnGroundLoot(boss.x, boss.y, "boss", client.sessionId, randRange(BOSS_GOLD_MIN, BOSS_GOLD_MAX));
        checkLevelUp(player, this, client.sessionId);
        this.broadcast("boss_killed", { bossId, bossType: boss.bossType, killerId: client.sessionId, killerName: player.name, xp: BOSS_XP });
        this.broadcastKillAndQuest( { targetId: bossId, killerId: client.sessionId, killerName: player.name, xp: BOSS_XP });

        // Schedule respawn
        this.clock.setTimeout(() => {
          this.broadcast("boss_warning", { bossType: boss.bossType, message: `⚠️ The ${boss.bossType === "dragon" ? "Dragon" : "Boss"} stirs in the wilderness...` });
        }, BOSS_RESPAWN_MS - BOSS_SPAWN_ANNOUNCE_MS);
        this.clock.setTimeout(() => {
          boss.hp = BOSS_HP;
          boss.maxHp = BOSS_HP;
          boss.phase = 1;
          boss.x = boss.spawnX;
          boss.y = boss.spawnY;
          boss.targetPlayerId = "";
          boss.alive = true;
          this.broadcast("boss_spawn", { bossId: boss.id, bossType: boss.bossType });
        }, BOSS_RESPAWN_MS);
      }
      return;
    }

    // Try world event target (golden slime)
    const worldEvt = this.state.worldEvents.get(player.targetId);
    if (worldEvt && worldEvt.active && worldEvt.eventType === "golden_slime" && worldEvt.hp > 0) {
      const d = dist(px, py, worldEvt.x, worldEvt.y);
      if (d > cfg.range) return;
      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      worldEvt.hp = Math.max(0, worldEvt.hp - damage);

      if (player.playerClass === "ranger") {
        this.broadcast("projectile", {
          fromX: px + TILE_SIZE / 2, fromY: py,
          toX: worldEvt.x + TILE_SIZE / 2, toY: worldEvt.y,
          attackerId: client.sessionId,
          type: "golden",
        });
      }

      this.broadcast("hit", { targetId: player.targetId, damage, attackerId: client.sessionId });

      if (worldEvt.hp <= 0) {
        worldEvt.active = false;
        const evtId = player.targetId;
        player.targetId = "";
        const gold = randRange(GOLDEN_SLIME_GOLD_MIN, GOLDEN_SLIME_GOLD_MAX);
        player.xp += GOLDEN_SLIME_XP;
        this.spawnGroundLoot(worldEvt.x, worldEvt.y, "boss", client.sessionId, gold);
        checkLevelUp(player, this, client.sessionId);
        updateQuestProgress(player, "slime", this, client.sessionId);

        this.broadcast("world_event_end", {
          id: evtId,
          eventType: "golden_slime",
          message: `✨ ${player.name} slayed the Golden Slime! (+${GOLDEN_SLIME_XP} XP, +${gold} gold)`,
        });
        this.broadcast("kill", {
          targetId: evtId,
          killerId: client.sessionId,
          killerName: player.name,
          xp: GOLDEN_SLIME_XP,
        });
        this.clock.setTimeout(() => { this.state.worldEvents.delete(evtId); }, 3000);
      }
      return;
    }

    // Target invalid — clear
    player.targetId = "";
  }

  spawnWorldEvent() {
    const eventTypes = ["treasure_chest", "mana_shrine", "golden_slime", "xp_orb"];
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    
    // Find a valid spawn location (outside village, on walkable tile)
    let spawnX = 0, spawnY = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const tx = 3 + Math.floor(Math.random() * (MAP_W - 6));
      const ty = 3 + Math.floor(Math.random() * (MAP_H - 6));
      // Not in village
      if (tx >= 26 && tx <= 46 && ty >= 26 && ty <= 46) continue;
      if (!canWalk(tx, ty)) continue;
      spawnX = tx;
      spawnY = ty;
      break;
    }
    if (spawnX === 0 && spawnY === 0) return; // couldn't find spot

    const now = Date.now();
    const id = `event_${worldEventCounter++}`;
    const evt = new WorldEventState();
    evt.id = id;
    evt.eventType = eventType;
    evt.x = spawnX * TILE_SIZE;
    evt.y = spawnY * TILE_SIZE;
    evt.spawnedAt = now;
    evt.active = true;

    switch (eventType) {
      case "treasure_chest":
        evt.expiresAt = now + TREASURE_CHEST_DURATION_MS;
        evt.hp = 0;
        evt.maxHp = 0;
        break;
      case "mana_shrine":
        evt.expiresAt = now + MANA_SHRINE_DURATION_MS;
        evt.hp = 0;
        evt.maxHp = 0;
        break;
      case "golden_slime":
        evt.expiresAt = now + GOLDEN_SLIME_DURATION_MS;
        evt.hp = GOLDEN_SLIME_HP;
        evt.maxHp = GOLDEN_SLIME_HP;
        break;
      case "xp_orb":
        evt.expiresAt = now + XP_ORB_DURATION_MS;
        evt.hp = 0;
        evt.maxHp = 0;
        break;
    }

    this.state.worldEvents.set(id, evt);

    // Announce to all players
    const typeNames: Record<string, string> = {
      treasure_chest: "💰 A Treasure Chest has appeared in the wilderness!",
      mana_shrine: "🔮 A Mana Shrine has materialized! Stand near it to heal!",
      golden_slime: "✨ A Golden Slime has spawned! Catch it for huge rewards!",
      xp_orb: "⭐ A glowing XP Orb has appeared! First to reach it gets bonus XP!",
    };

    this.broadcast("world_event_spawn", {
      id,
      eventType,
      x: evt.x,
      y: evt.y,
      message: typeNames[eventType] || "A mysterious event has appeared!",
      duration: evt.expiresAt - now,
    });
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
        // Frost slow: skip 50% of movement ticks when frosted
        if (wolf.frostedUntil > now && Math.random() < 0.5) return;
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
            const damage = applyDefense(rawDmg, closest.defense, closest);
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
        // Frost slow: skip 50% of movement ticks when frosted
        const slimeNow = Date.now();
        if (slime.frostedUntil > slimeNow && Math.random() < 0.5) return;
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
              const damage = applyDefense(rawDmg, target.defense, target);
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
        // Frost slow
        if (goblin.frostedUntil > now && Math.random() < 0.5) return;
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
            const damage = applyDefense(rawDmg, closest.defense, closest);
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
        // Frost slow
        if (skeleton.frostedUntil > now && Math.random() < 0.5) return;
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
            const damage = applyDefense(rawDmg, closest.defense, closest);
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

    // ── Boss Dragon Spawn ──
    // Find a spawn spot in the dangerous outer zone
    let bossSpawnX = 8, bossSpawnY = 8;
    for (let attempt = 0; attempt < 100; attempt++) {
      const bx = 4 + Math.floor(Math.random() * 10);
      const by = 4 + Math.floor(Math.random() * 10);
      if (canWalk(bx, by)) { bossSpawnX = bx; bossSpawnY = by; break; }
    }
    const dragon = new BossState();
    dragon.id = "boss_dragon";
    dragon.bossType = "dragon";
    dragon.x = bossSpawnX * TILE_SIZE;
    dragon.y = bossSpawnY * TILE_SIZE;
    dragon.spawnX = dragon.x;
    dragon.spawnY = dragon.y;
    dragon.hp = BOSS_HP;
    dragon.maxHp = BOSS_HP;
    dragon.alive = true;
    dragon.phase = 1;
    this.state.bosses.set(dragon.id, dragon);

    // Boss AI — aggressive, AOE attacks, enrage at low HP
    const bossLastAttack = new Map<string, number>();
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.bosses.forEach((boss) => {
        if (!boss.alive) return;
        // Frost slow (only 25% slowdown on bosses — they resist)
        if (boss.frostedUntil > now && Math.random() < 0.25) return;
        const btx = Math.round(boss.x / TILE_SIZE);
        const bty = Math.round(boss.y / TILE_SIZE);

        let closest: PlayerState | null = null;
        let closestSid = "";
        let closestDist = Infinity;
        this.state.players.forEach((p, sid) => {
          if (p.hp <= 0) return;
          const d = Math.max(Math.abs(Math.round(p.x / TILE_SIZE) - btx), Math.abs(Math.round(p.y / TILE_SIZE) - bty));
          if (d <= BOSS_CHASE_RANGE && d < closestDist) {
            closest = p; closestSid = sid; closestDist = d;
          }
        });

        if (!closest && boss.targetPlayerId) {
          const tracked = this.state.players.get(boss.targetPlayerId);
          if (tracked && tracked.hp > 0) {
            const d = Math.max(Math.abs(Math.round(tracked.x / TILE_SIZE) - btx), Math.abs(Math.round(tracked.y / TILE_SIZE) - bty));
            if (d <= BOSS_LEASH_RANGE) { closest = tracked; closestSid = boss.targetPlayerId; closestDist = d; }
          }
        }

        if (!closest) {
          boss.targetPlayerId = "";
          // Boss wanders slowly
          if (Math.random() > 0.2) return;
          const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          const dir = dirs[Math.floor(Math.random() * dirs.length)];
          const nx = boss.x + dir.dx * TILE_SIZE, ny = boss.y + dir.dy * TILE_SIZE;
          const ntx = Math.round(nx / TILE_SIZE), nty = Math.round(ny / TILE_SIZE);
          if (!canWalk(ntx, nty)) return;
          if (ntx >= 28 && ntx <= 44 && nty >= 28 && nty <= 44) return;
          boss.x = nx; boss.y = ny;
          return;
        }

        boss.targetPlayerId = closestSid;

        if (closestDist <= 1) {
          if (isProtectionZone(closest.x, closest.y)) return;
          const last = bossLastAttack.get(boss.id) || 0;
          const atkInterval = boss.phase === 2 ? BOSS_ATTACK_INTERVAL_MS * 0.6 : BOSS_ATTACK_INTERVAL_MS;
          if (now - last >= atkInterval) {
            bossLastAttack.set(boss.id, now);
            const atkMult = boss.phase === 2 ? BOSS_PHASE2_ATK_MULT : 1;
            
            // AOE attack chance
            if (Math.random() < BOSS_AOE_CHANCE) {
              // Hit ALL players in range
              this.state.players.forEach((p, sid) => {
                if (p.hp <= 0) return;
                if (isProtectionZone(p.x, p.y)) return;
                const d = Math.max(Math.abs(Math.round(p.x / TILE_SIZE) - btx), Math.abs(Math.round(p.y / TILE_SIZE) - bty));
                if (d > BOSS_AOE_RANGE) return;
                const rawDmg = Math.floor((BOSS_ATK + Math.floor(Math.random() * 15)) * atkMult);
                const damage = applyDefense(rawDmg, p.defense, p);
                p.hp = Math.max(0, p.hp - damage);
                this.broadcast("hit", { targetId: sid, damage, x: p.x + TILE_SIZE / 2, y: p.y, attackerId: boss.id });
                // Boss always applies burn
                if (Math.random() < BOSS_BURN_CHANCE) {
                  applyStatusEffect(p, "burn", BURN_DURATION_MS * 1.5);
                  this.broadcast("status_applied", { sessionId: sid, effect: "burn" });
                }
                if (p.hp <= 0) {
                  this.broadcast("kill", { targetId: sid, killerId: boss.id, killerName: "Dragon", xp: 0 });
                }
              });
              this.broadcast("boss_aoe", { bossId: boss.id, x: boss.x, y: boss.y, range: BOSS_AOE_RANGE });
            } else {
              // Single target attack
              const rawDmg = Math.floor((BOSS_ATK + Math.floor(Math.random() * 15)) * atkMult);
              const damage = applyDefense(rawDmg, closest.defense, closest);
              closest.hp = Math.max(0, closest.hp - damage);
              this.broadcast("hit", { targetId: closestSid, damage, x: closest.x + TILE_SIZE / 2, y: closest.y, attackerId: boss.id });
              if (Math.random() < BOSS_BURN_CHANCE) {
                applyStatusEffect(closest, "burn", BURN_DURATION_MS * 1.5);
                this.broadcast("status_applied", { sessionId: closestSid, effect: "burn" });
              }
              if (closest.hp <= 0) {
                boss.targetPlayerId = "";
                this.broadcast("kill", { targetId: closestSid, killerId: boss.id, killerName: "Dragon", xp: 0 });
              }
            }
          }
          return;
        }

        // Chase
        const ptx = Math.round(closest.x / TILE_SIZE), pty = Math.round(closest.y / TILE_SIZE);
        const step = bfsNextStep(btx, bty, ptx, pty, BOSS_LEASH_RANGE);
        if (step) {
          boss.x = step.x * TILE_SIZE; boss.y = step.y * TILE_SIZE;
        }
      });
    }, BOSS_MOVE_INTERVAL_MS);

    // ── World Events System ──
    const scheduleNextWorldEvent = () => {
      const delay = WORLD_EVENT_MIN_INTERVAL_MS + Math.random() * (WORLD_EVENT_MAX_INTERVAL_MS - WORLD_EVENT_MIN_INTERVAL_MS);
      this.clock.setTimeout(() => {
        this.spawnWorldEvent();
        scheduleNextWorldEvent();
      }, delay);
    };
    // Start first event sooner (30-60s) so players see it quickly
    this.clock.setTimeout(() => {
      this.spawnWorldEvent();
      scheduleNextWorldEvent();
    }, 30000 + Math.random() * 30000);

    // World event tick — golden slime AI + mana shrine healing + expiry
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.worldEvents.forEach((evt, evtId) => {
        if (!evt.active) return;

        // Check expiry
        if (now >= evt.expiresAt) {
          evt.active = false;
          if (evt.eventType === "golden_slime") {
            this.broadcast("world_event_end", { id: evtId, eventType: evt.eventType, message: "✨ The Golden Slime escaped!" });
          } else {
            this.broadcast("world_event_end", { id: evtId, eventType: evt.eventType, message: `The ${evt.eventType.replace("_", " ")} faded away...` });
          }
          this.clock.setTimeout(() => { this.state.worldEvents.delete(evtId); }, 3000);
          return;
        }

        // Mana Shrine: heal nearby players every tick
        if (evt.eventType === "mana_shrine") {
          const etx = Math.round(evt.x / TILE_SIZE);
          const ety = Math.round(evt.y / TILE_SIZE);
          this.state.players.forEach((p, sid) => {
            if (p.hp <= 0) return;
            const px = Math.round(p.x / TILE_SIZE);
            const py = Math.round(p.y / TILE_SIZE);
            const d = Math.max(Math.abs(px - etx), Math.abs(py - ety));
            if (d <= MANA_SHRINE_RANGE) {
              let healed = false;
              if (p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + 10); healed = true; }
              if (p.mp < p.maxMp) { p.mp = Math.min(p.maxMp, p.mp + 10); healed = true; }
              // Clear status effects near shrine
              if (p.statusEffect) { p.statusEffect = ""; p.statusEffectEnd = 0; healed = true; }
            }
          });
        }

        // Golden Slime AI: runs away from nearest player
        if (evt.eventType === "golden_slime" && evt.hp > 0) {
          const etx = Math.round(evt.x / TILE_SIZE);
          const ety = Math.round(evt.y / TILE_SIZE);

          // Find nearest player
          let nearestDist = Infinity;
          let nearestPx = etx, nearestPy = ety;
          this.state.players.forEach((p) => {
            if (p.hp <= 0) return;
            const px = Math.round(p.x / TILE_SIZE);
            const py = Math.round(p.y / TILE_SIZE);
            const d = Math.max(Math.abs(px - etx), Math.abs(py - ety));
            if (d < nearestDist) { nearestDist = d; nearestPx = px; nearestPy = py; }
          });

          // If a player is within 6 tiles, run away
          if (nearestDist <= 6 && nearestDist > 0) {
            // Move in opposite direction from nearest player
            const dx = etx - nearestPx;
            const dy = ety - nearestPy;
            // Normalize to -1, 0, or 1
            const mdx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
            const mdy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);

            // Try primary direction, then fallback to just x or y
            const moves = [
              { dx: mdx, dy: mdy },
              { dx: mdx, dy: 0 },
              { dx: 0, dy: mdy },
              // Random perpendicular if stuck
              { dx: mdy || 1, dy: 0 },
              { dx: 0, dy: mdx || 1 },
            ];

            for (const m of moves) {
              if (m.dx === 0 && m.dy === 0) continue;
              const nx = etx + m.dx;
              const ny = ety + m.dy;
              if (canWalk(nx, ny) && !(nx >= 28 && nx <= 44 && ny >= 28 && ny <= 44)) {
                evt.x = nx * TILE_SIZE;
                evt.y = ny * TILE_SIZE;
                break;
              }
            }
          } else if (Math.random() < 0.3) {
            // Random wander when no players nearby
            const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
            const dir = dirs[Math.floor(Math.random() * dirs.length)];
            const nx = etx + dir.dx, ny = ety + dir.dy;
            if (canWalk(nx, ny) && !(nx >= 28 && nx <= 44 && ny >= 28 && ny <= 44)) {
              evt.x = nx * TILE_SIZE;
              evt.y = ny * TILE_SIZE;
            }
          }
        }
      });
    }, 1000); // tick every second

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

    // Mana regen tick (+ temple fast regen + buff expiry)
    this.clock.setInterval(() => {
      const regenNow = Date.now();
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

        // War Cry buff expiry
        if (player.buffWarCryEnd > 0 && regenNow >= player.buffWarCryEnd) {
          player.buffWarCryAtk = 0;
          player.buffWarCryEnd = 0;
          recalcEquipBonuses(player);
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

    // Fishing state (declared early so move handler can cancel it)
    const fishingPlayers = new Map<string, { startTime: number; duration: number }>();

    // ── Movement ──
    this.onMessage("move", (client, data: { dx: number; dy: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      // Cancel fishing on move
      if (fishingPlayers.has(client.sessionId)) {
        fishingPlayers.delete(client.sessionId);
        client.send("fish_cancel_notify", {});
      }

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
      this.state.bosses.forEach((boss) => {
        if (boss.alive && boss.x === newX && boss.y === newY) monsterBlocking = true;
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
        const boss = this.state.bosses.get(tid);
        const targetPlayer = this.state.players.get(tid);
        const worldEvent = this.state.worldEvents.get(tid);
        const valid = (slime && slime.alive) || (wolf && wolf.alive) || (goblin && goblin.alive) || (skeleton && skeleton.alive) || (boss && boss.alive) || (targetPlayer && targetPlayer.hp > 0 && tid !== client.sessionId) || (worldEvent && worldEvent.active && worldEvent.eventType === "golden_slime" && worldEvent.hp > 0);
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

      // Also send available quests and turn-in quests for this NPC
      const activeQuestIds = new Set<string>();
      const activeQuestMap = new Map<string, { progress: number }>();
      for (let i = 0; i < player.quests.length; i++) {
        const q = player.quests.at(i);
        if (q && !q.turnedIn) {
          activeQuestIds.add(q.questId);
          activeQuestMap.set(q.questId, { progress: q.progress });
        }
      }

      const available = getAvailableQuests(npc.id, player.level, player.completedQuestIds, activeQuestIds);
      const turnIn = getTurnInQuests(npc.id, activeQuestMap);

      if (available.length > 0 || turnIn.length > 0) {
        client.send("npc_quests", {
          npcId: npc.id,
          npcName: npc.name,
          available: available.map(q => ({
            id: q.id, name: q.name, description: q.description, icon: q.icon,
            killTarget: q.killTarget, killCount: q.killCount,
            rewards: q.rewards, requiredLevel: q.requiredLevel,
          })),
          turnIn: turnIn.map(q => ({
            id: q.id, name: q.name, icon: q.icon,
            rewards: q.rewards,
          })),
        });
      }
    });

    // ── Quest Accept ──
    this.onMessage("quest_accept", (client, data: { questId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const questDef = QUESTS[data.questId];
      if (!questDef) return;
      if (player.level < questDef.requiredLevel) return;
      if (questDef.prerequisite && !player.completedQuestIds.has(questDef.prerequisite)) return;

      // Check not already active
      for (let i = 0; i < player.quests.length; i++) {
        const q = player.quests.at(i);
        if (q && q.questId === data.questId && !q.turnedIn) return;
      }
      // Check not already completed (unless repeatable)
      if (player.completedQuestIds.has(data.questId) && questDef.repeatCooldownMs === undefined) return;

      // Max 5 active quests
      let activeCount = 0;
      for (let i = 0; i < player.quests.length; i++) {
        const q = player.quests.at(i);
        if (q && !q.turnedIn) activeCount++;
      }
      if (activeCount >= 5) {
        client.send("quest_error", { message: "Quest log full! (max 5 active quests)" });
        return;
      }

      const slot = new QuestSlot();
      slot.questId = data.questId;
      slot.progress = 0;
      slot.required = questDef.killCount;
      slot.completed = false;
      slot.turnedIn = false;
      player.quests.push(slot);

      client.send("quest_accepted", { questId: data.questId, questName: questDef.name, icon: questDef.icon });
      this.sendQuestMarkers(client, player);
    });

    // ── Quest Turn In ──
    this.onMessage("quest_turnin", (client, data: { questId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const questDef = QUESTS[data.questId];
      if (!questDef) return;

      // Find the active quest slot
      let questSlot: QuestSlot | null = null;
      let questIdx = -1;
      for (let i = 0; i < player.quests.length; i++) {
        const q = player.quests.at(i);
        if (q && q.questId === data.questId && q.completed && !q.turnedIn) {
          questSlot = q;
          questIdx = i;
          break;
        }
      }
      if (!questSlot) return;

      // Grant rewards
      player.xp += questDef.rewards.xp;
      player.gold += questDef.rewards.gold;
      if (questDef.rewards.items) {
        for (const item of questDef.rewards.items) {
          addToInventory(player, item.itemId, item.quantity);
        }
      }

      // Mark as completed
      questSlot.turnedIn = true;
      player.completedQuestIds.add(data.questId);

      // Remove from active quests array
      player.quests.splice(questIdx, 1);

      // Check level up
      checkLevelUp(player, this, client.sessionId);

      // Build reward description
      const rewardParts: string[] = [`${questDef.rewards.xp} XP`, `${questDef.rewards.gold} gold`];
      if (questDef.rewards.items) {
        for (const ri of questDef.rewards.items) {
          const it = ITEMS[ri.itemId];
          if (it) rewardParts.push(`${it.icon || ""} ${it.name}${ri.quantity > 1 ? ` x${ri.quantity}` : ""}`);
        }
      }

      client.send("quest_turned_in", {
        questId: data.questId,
        questName: questDef.name,
        rewards: rewardParts.join(", "),
      });
      this.sendQuestMarkers(client, player);

      this.broadcast("quest_completed_announce", {
        playerName: player.name,
        questName: questDef.name,
        questIcon: questDef.icon,
      });
    });

    // ── Quest Abandon ──
    this.onMessage("quest_abandon", (client, data: { questId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      for (let i = 0; i < player.quests.length; i++) {
        const q = player.quests.at(i);
        if (q && q.questId === data.questId && !q.turnedIn) {
          player.quests.splice(i, 1);
          client.send("quest_abandoned", { questId: data.questId });
          break;
        }
      }
    });

    // ── Pickup ground item ──
    this.onMessage("pickup_item", (client, data: { itemId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const dropped = this.state.droppedItems.get(data.itemId);
      if (!dropped) return;
      
      // Check proximity (must be within 1.5 tiles)
      const px = Math.round(player.x / TILE_SIZE);
      const py = Math.round(player.y / TILE_SIZE);
      const dx = Math.round(dropped.x / TILE_SIZE);
      const dy = Math.round(dropped.y / TILE_SIZE);
      if (Math.abs(px - dx) > 1 || Math.abs(py - dy) > 1) return;
      
      // Check loot protection
      const now = Date.now();
      if (dropped.ownerSessionId && dropped.ownerSessionId !== client.sessionId && 
          now - dropped.droppedAt < LOOT_PROTECTION_MS) return;
      
      // Handle gold specially
      if (dropped.itemId === "gold") {
        player.gold += dropped.quantity;
        this.state.droppedItems.delete(data.itemId);
        client.send("loot_received", { items: [`🪙 ${dropped.quantity} gold`] });
        return;
      }
      
      // Try to add to inventory
      if (addToInventory(player, dropped.itemId, dropped.quantity)) {
        const it = ITEMS[dropped.itemId];
        const name = `${it?.icon || ""} ${it?.name || dropped.itemId}${dropped.quantity > 1 ? ` x${dropped.quantity}` : ""}`;
        client.send("loot_received", { items: [name] });
        this.state.droppedItems.delete(data.itemId);
      } else {
        client.send("quest_error", { message: "Inventory full!" });
      }
    });

    // ── Fishing System ──
    const FISH_LOOT = [
      { itemId: "small_fish", chance: 0.50, name: "Small Fish", icon: "🐟" },
      { itemId: "big_fish", chance: 0.25, name: "Big Fish", icon: "🐠" },
      { itemId: "golden_fish", chance: 0.05, name: "Golden Fish", icon: "✨🐟" },
      { itemId: "treasure_chest", chance: 0.03, name: "Sunken Treasure", icon: "🧰" },
    ];

    this.onMessage("fish_start", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (fishingPlayers.has(client.sessionId)) return; // already fishing
      
      // Check if adjacent to water
      const px = Math.round(player.x / TILE_SIZE);
      const py = Math.round(player.y / TILE_SIZE);
      let nearWater = false;
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const tx = px + dx, ty = py + dy;
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
          if (WORLD_MAP[ty]?.[tx] === TILE.WATER) { nearWater = true; break; }
        }
      }
      if (!nearWater) {
        client.send("fish_result", { success: false, message: "You need to stand next to water to fish!" });
        return;
      }
      
      // Start fishing — takes 2-4 seconds
      const duration = 2000 + Math.random() * 2000;
      fishingPlayers.set(client.sessionId, { startTime: Date.now(), duration });
      client.send("fish_cast", { duration });
      
      // Schedule the catch
      this.clock.setTimeout(() => {
        if (!fishingPlayers.has(client.sessionId)) return; // cancelled
        fishingPlayers.delete(client.sessionId);
        
        const currentPlayer = this.state.players.get(client.sessionId);
        if (!currentPlayer || currentPlayer.hp <= 0) return;
        
        // Roll for catch
        let caught = false;
        for (const fish of FISH_LOOT) {
          if (Math.random() < fish.chance) {
            if (fish.itemId === "treasure_chest") {
              // Treasure gives gold directly
              currentPlayer.gold += 200;
              client.send("fish_result", { 
                success: true, 
                message: `You found a ${fish.icon} ${fish.name}! +200 gold!`,
                itemId: fish.itemId,
                icon: fish.icon,
              });
            } else if (addToInventory(currentPlayer, fish.itemId, 1)) {
              client.send("fish_result", { 
                success: true, 
                message: `You caught a ${fish.icon} ${fish.name}!`,
                itemId: fish.itemId,
                icon: fish.icon,
              });
            } else {
              client.send("fish_result", { success: false, message: "You caught something but your inventory is full!" });
            }
            // Give small XP for fishing
            currentPlayer.xp += 10;
            checkLevelUp(currentPlayer, this, client.sessionId);
            caught = true;
            break;
          }
        }
        if (!caught) {
          client.send("fish_result", { success: false, message: "The fish got away..." });
        }
      }, duration);
    });
    
    this.onMessage("fish_cancel", (client) => {
      fishingPlayers.delete(client.sessionId);
    });

    // ── World Event Interaction ──
    this.onMessage("interact_event", (client, data: { eventId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const evt = this.state.worldEvents.get(data.eventId);
      if (!evt || !evt.active) return;

      const px = Math.round(player.x / TILE_SIZE);
      const py = Math.round(player.y / TILE_SIZE);
      const ex = Math.round(evt.x / TILE_SIZE);
      const ey = Math.round(evt.y / TILE_SIZE);
      const d = Math.max(Math.abs(px - ex), Math.abs(py - ey));

      if (evt.eventType === "treasure_chest") {
        if (d > 1) return; // must be adjacent
        evt.active = false;
        const gold = randRange(TREASURE_CHEST_GOLD_MIN, TREASURE_CHEST_GOLD_MAX);
        player.gold += gold;
        // Also roll some bonus loot
        const bonusItems = rollLoot("wolf"); // use wolf loot table for treasure
        for (const drop of bonusItems) {
          addToInventory(player, drop.itemId, drop.quantity);
        }
        const itemNames = bonusItems.map(d => {
          const it = ITEMS[d.itemId];
          return `${it?.icon || ""} ${it?.name || d.itemId}`;
        });
        client.send("event_reward", {
          eventType: "treasure_chest",
          message: `💰 You opened the treasure chest! +${gold} gold${itemNames.length > 0 ? " + " + itemNames.join(", ") : ""}!`,
        });
        this.broadcast("world_event_end", {
          id: data.eventId,
          eventType: "treasure_chest",
          message: `💰 ${player.name} opened the Treasure Chest!`,
        });
        this.clock.setTimeout(() => { this.state.worldEvents.delete(data.eventId); }, 2000);
      }

      if (evt.eventType === "xp_orb") {
        if (d > 1) return;
        evt.active = false;
        player.xp += XP_ORB_XP;
        checkLevelUp(player, this, client.sessionId);
        client.send("event_reward", {
          eventType: "xp_orb",
          message: `⭐ You absorbed the XP Orb! +${XP_ORB_XP} XP!`,
        });
        this.broadcast("world_event_end", {
          id: data.eventId,
          eventType: "xp_orb",
          message: `⭐ ${player.name} grabbed the XP Orb!`,
        });
        this.clock.setTimeout(() => { this.state.worldEvents.delete(data.eventId); }, 2000);
      }
    });

    // ── Attack World Event (Golden Slime) ──
    this.onMessage("attack_event", (client, data: { eventId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const evt = this.state.worldEvents.get(data.eventId);
      if (!evt || !evt.active || evt.eventType !== "golden_slime" || evt.hp <= 0) return;

      const cfg = CLASS_CONFIG[player.playerClass] || CLASS_CONFIG.warrior;
      const d = dist(player.x, player.y, evt.x, evt.y);
      if (d > cfg.range) return;

      const damage = Math.max(1, player.attack + Math.floor(Math.random() * 10) - 5);
      evt.hp = Math.max(0, evt.hp - damage);

      if (player.playerClass === "ranger") {
        this.broadcast("projectile", {
          fromX: player.x + TILE_SIZE / 2, fromY: player.y,
          toX: evt.x + TILE_SIZE / 2, toY: evt.y,
          attackerId: client.sessionId,
          type: "golden",
        });
      }

      this.broadcast("hit", { targetId: data.eventId, damage, attackerId: client.sessionId });

      if (evt.hp <= 0) {
        evt.active = false;
        const gold = randRange(GOLDEN_SLIME_GOLD_MIN, GOLDEN_SLIME_GOLD_MAX);
        player.xp += GOLDEN_SLIME_XP;
        // Spawn ground loot (guaranteed rare drops)
        this.spawnGroundLoot(evt.x, evt.y, "boss", client.sessionId, gold);
        checkLevelUp(player, this, client.sessionId);
        // Also give quest credit as slime kill
        updateQuestProgress(player, "slime", this, client.sessionId);

        this.broadcast("world_event_end", {
          id: data.eventId,
          eventType: "golden_slime",
          message: `✨ ${player.name} slayed the Golden Slime! (+${GOLDEN_SLIME_XP} XP, +${gold} gold)`,
        });
        this.broadcast("kill", {
          targetId: data.eventId,
          killerId: client.sessionId,
          killerName: player.name,
          xp: GOLDEN_SLIME_XP,
        });
        this.clock.setTimeout(() => { this.state.worldEvents.delete(data.eventId); }, 3000);
      }
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

      // Don't waste potions at full (only block if ALL effects are maxed)
      const hpFull = !item.effect?.hp || player.hp >= player.maxHp;
      const mpFull = !item.effect?.mp || player.mp >= player.maxMp;
      if (hpFull && mpFull) return;

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
          this.broadcastKillAndQuest({ targetId: `slime_${sIdx}`, killerId: client.sessionId, killerName: player.name, xp: xpGain });
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
          this.spawnGroundLoot(wolf.x, wolf.y, "wolf", client.sessionId, randRange(WOLF_GOLD_MIN, WOLF_GOLD_MAX));
          const newLevel = levelFromXp(player.xp);
          if (newLevel > player.level) { player.level = newLevel; player.maxHp = cfg.hpBase + (newLevel - 1) * 20; player.hp = player.maxHp; player.attack = cfg.attackBase + (newLevel - 1) * 5; player.maxMp = cfg.mpBase + (newLevel - 1) * 10; player.mp = player.maxMp; this.broadcast("levelup", { sessionId: client.sessionId, name: player.name, level: newLevel }); }
          this.broadcastKillAndQuest( { targetId: player.targetId, killerId: client.sessionId, killerName: player.name, xp: WOLF_XP });
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
          player.xp += GOBLIN_XP;
          this.spawnGroundLoot(goblinT.x, goblinT.y, "goblin", client.sessionId, randRange(GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX));
          checkLevelUp(player, this, client.sessionId);
          this.broadcastKillAndQuest( { targetId: player.targetId, killerId: client.sessionId, killerName: player.name, xp: GOBLIN_XP });
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
          player.xp += SKELETON_XP;
          this.spawnGroundLoot(skelT.x, skelT.y, "skeleton", client.sessionId, randRange(SKELETON_GOLD_MIN, SKELETON_GOLD_MAX));
          checkLevelUp(player, this, client.sessionId);
          this.broadcastKillAndQuest( { targetId: player.targetId, killerId: client.sessionId, killerName: player.name, xp: SKELETON_XP });
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
          this.broadcastKillAndQuest({ targetId: `slime_${sIdx}`, killerId: client.sessionId, killerName: player.name, xp: xpGain });
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
          this.spawnGroundLoot(wolf.x, wolf.y, "wolf", client.sessionId, randRange(WOLF_GOLD_MIN, WOLF_GOLD_MAX));
          this.broadcastKillAndQuest( { targetId: wolfId, killerId: client.sessionId, killerName: player.name, xp: WOLF_XP });
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
          player.xp += GOBLIN_XP;
          this.spawnGroundLoot(goblin.x, goblin.y, "goblin", client.sessionId, randRange(GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX));
          this.broadcastKillAndQuest( { targetId: goblinId, killerId: client.sessionId, killerName: player.name, xp: GOBLIN_XP });
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
          player.xp += SKELETON_XP;
          this.spawnGroundLoot(skeleton.x, skeleton.y, "skeleton", client.sessionId, randRange(SKELETON_GOLD_MIN, SKELETON_GOLD_MAX));
          this.broadcastKillAndQuest( { targetId: skeletonId, killerId: client.sessionId, killerName: player.name, xp: SKELETON_XP });
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

    // ── Shield Wall (Warrior) — 50% damage reduction for 6 seconds ──
    this.onMessage("shield_wall", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (player.playerClass !== "warrior") return;
      if (player.mp < SHIELD_WALL_COST) return;
      const now = Date.now();
      if (getAbilityCooldown(client.sessionId, "shield_wall") > now) return;
      // Don't recast if already active
      if (player.buffShieldWallEnd > now) return;

      player.mp -= SHIELD_WALL_COST;
      player.buffShieldWallEnd = now + SHIELD_WALL_DURATION_MS;
      setAbilityCooldown(client.sessionId, "shield_wall", now + SHIELD_WALL_COOLDOWN_MS);

      this.broadcast("shield_wall_effect", { sessionId: client.sessionId, duration: SHIELD_WALL_DURATION_MS });
    });

    // ── War Cry (Warrior) — +50% attack for 10 seconds, buffs nearby allies ──
    this.onMessage("war_cry", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (player.playerClass !== "warrior") return;
      if (player.mp < WAR_CRY_COST) return;
      const now = Date.now();
      if (getAbilityCooldown(client.sessionId, "war_cry") > now) return;

      player.mp -= WAR_CRY_COST;
      setAbilityCooldown(client.sessionId, "war_cry", now + WAR_CRY_COOLDOWN_MS);

      // Apply buff to caster
      const cfg = CLASS_CONFIG[player.playerClass] || CLASS_CONFIG.warrior;
      const baseAtk = cfg.attackBase + (player.level - 1) * 5;
      const bonus = Math.floor(baseAtk * WAR_CRY_ATK_BONUS);
      player.buffWarCryAtk = bonus;
      player.buffWarCryEnd = now + WAR_CRY_DURATION_MS;
      recalcEquipBonuses(player);

      // Buff nearby allies
      const px = Math.round(player.x / TILE_SIZE);
      const py = Math.round(player.y / TILE_SIZE);
      const buffedPlayers = [client.sessionId];
      this.state.players.forEach((ally, sid) => {
        if (sid === client.sessionId || ally.hp <= 0) return;
        const ax = Math.round(ally.x / TILE_SIZE);
        const ay = Math.round(ally.y / TILE_SIZE);
        const d = Math.max(Math.abs(ax - px), Math.abs(ay - py));
        if (d <= WAR_CRY_RANGE) {
          const allyCfg = CLASS_CONFIG[ally.playerClass] || CLASS_CONFIG.warrior;
          const allyBaseAtk = allyCfg.attackBase + (ally.level - 1) * 5;
          const allyBonus = Math.floor(allyBaseAtk * WAR_CRY_ATK_BONUS);
          ally.buffWarCryAtk = allyBonus;
          ally.buffWarCryEnd = now + WAR_CRY_DURATION_MS;
          recalcEquipBonuses(ally);
          buffedPlayers.push(sid);
        }
      });

      this.broadcast("war_cry_effect", { sessionId: client.sessionId, x: player.x, y: player.y, range: WAR_CRY_RANGE, buffed: buffedPlayers, duration: WAR_CRY_DURATION_MS });
    });

    // ── Frost Arrow (Ranger) — damages and slows target ──
    this.onMessage("frost_arrow", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (player.playerClass !== "ranger") return;
      if (player.mp < FROST_ARROW_COST) return;
      if (!player.targetId) return;
      const now = Date.now();
      if (getAbilityCooldown(client.sessionId, "frost_arrow") > now) return;

      const cfg = CLASS_CONFIG.ranger;
      const px = player.x, py = player.y;

      // Find the target monster and apply frost
      const applyFrost = (monster: { x: number; y: number; hp: number; alive: boolean; frostedUntil: number }, mId: string, maxHp: number): boolean => {
        if (!monster.alive) return false;
        const d = dist(px, py, monster.x, monster.y);
        if (d > cfg.range) return false;
        
        player.mp -= FROST_ARROW_COST;
        setAbilityCooldown(client.sessionId, "frost_arrow", now + FROST_ARROW_COOLDOWN_MS);
        
        const damage = Math.max(1, Math.floor(player.attack * FROST_ARROW_DAMAGE_MULT) + Math.floor(Math.random() * 8) - 4);
        monster.hp = Math.max(0, monster.hp - damage);
        monster.frostedUntil = now + FROST_ARROW_DURATION_MS;
        
        // Projectile visual
        this.broadcast("projectile", { fromX: px + TILE_SIZE / 2, fromY: py, toX: monster.x + TILE_SIZE / 2, toY: monster.y, attackerId: client.sessionId, type: "frost" });
        this.broadcast("hit", { targetId: mId, damage, attackerId: client.sessionId });
        this.broadcast("frost_applied", { targetId: mId, duration: FROST_ARROW_DURATION_MS });
        
        return true;
      };

      // Try each monster type
      const slime = this.state.slimes.get(player.targetId);
      if (slime) { 
        if (applyFrost(slime as any, player.targetId, slime.maxHp)) {
          slime.targetPlayerId = client.sessionId;
          if (slime.hp <= 0) {
            slime.alive = false; slime.targetPlayerId = "";
            player.targetId = "";
            let sIdx = 0;
            this.state.slimes.forEach((s, id) => { if (s === slime) { const idx = parseInt(id.split("_")[1]); if (!isNaN(idx)) sIdx = idx; } });
            const xpGain = SLIME_TYPES[SLIME_SPAWNS[sIdx]?.type || 0]?.xp || 25;
            player.xp += xpGain;
            this.spawnGroundLoot(slime.x, slime.y, "slime", client.sessionId, randRange(SLIME_GOLD_MIN, SLIME_GOLD_MAX));
            checkLevelUp(player, this, client.sessionId);
            this.broadcastKillAndQuest({ targetId: `slime_${sIdx}`, killerId: client.sessionId, killerName: player.name, xp: xpGain });
            this.clock.setTimeout(() => { const spawn = SLIME_SPAWNS[sIdx]; if (spawn) { const type = SLIME_TYPES[spawn.type]; slime.x = spawn.x * TILE_SIZE; slime.y = spawn.y * TILE_SIZE; slime.hp = type.hp; slime.maxHp = type.hp; slime.targetPlayerId = ""; slime.frostedUntil = 0; slime.alive = true; } }, SLIME_RESPAWN_MS);
          }
        }
        return;
      }

      const wolf = this.state.wolves.get(player.targetId);
      if (wolf) {
        if (applyFrost(wolf as any, player.targetId, wolf.maxHp)) {
          if (wolf.hp <= 0) {
            wolf.alive = false; wolf.targetPlayerId = "";
            const wolfId = player.targetId;
            player.targetId = "";
            player.xp += WOLF_XP;
            this.spawnGroundLoot(wolf.x, wolf.y, "wolf", client.sessionId, randRange(WOLF_GOLD_MIN, WOLF_GOLD_MAX));
            checkLevelUp(player, this, client.sessionId);
            this.broadcastKillAndQuest({ targetId: wolfId, killerId: client.sessionId, killerName: player.name, xp: WOLF_XP });
            this.clock.setTimeout(() => { wolf.x = wolf.spawnX; wolf.y = wolf.spawnY; wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP; wolf.targetPlayerId = ""; wolf.frostedUntil = 0; wolf.alive = true; }, WOLF_RESPAWN_MS);
          }
        }
        return;
      }

      const goblin = this.state.goblins.get(player.targetId);
      if (goblin) {
        if (applyFrost(goblin as any, player.targetId, goblin.maxHp)) {
          goblin.targetPlayerId = client.sessionId;
          if (goblin.hp <= 0) {
            goblin.alive = false; goblin.targetPlayerId = "";
            const gId = player.targetId;
            player.targetId = "";
            player.xp += GOBLIN_XP;
            this.spawnGroundLoot(goblin.x, goblin.y, "goblin", client.sessionId, randRange(GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX));
            checkLevelUp(player, this, client.sessionId);
            this.broadcastKillAndQuest({ targetId: gId, killerId: client.sessionId, killerName: player.name, xp: GOBLIN_XP });
            this.clock.setTimeout(() => { goblin.x = goblin.spawnX; goblin.y = goblin.spawnY; goblin.hp = GOBLIN_HP; goblin.maxHp = GOBLIN_HP; goblin.targetPlayerId = ""; goblin.frostedUntil = 0; goblin.alive = true; }, GOBLIN_RESPAWN_MS);
          }
        }
        return;
      }

      const skeleton = this.state.skeletons.get(player.targetId);
      if (skeleton) {
        if (applyFrost(skeleton as any, player.targetId, skeleton.maxHp)) {
          skeleton.targetPlayerId = client.sessionId;
          if (skeleton.hp <= 0) {
            skeleton.alive = false; skeleton.targetPlayerId = "";
            const sId = player.targetId;
            player.targetId = "";
            player.xp += SKELETON_XP;
            this.spawnGroundLoot(skeleton.x, skeleton.y, "skeleton", client.sessionId, randRange(SKELETON_GOLD_MIN, SKELETON_GOLD_MAX));
            checkLevelUp(player, this, client.sessionId);
            this.broadcastKillAndQuest({ targetId: sId, killerId: client.sessionId, killerName: player.name, xp: SKELETON_XP });
            this.clock.setTimeout(() => { skeleton.x = skeleton.spawnX; skeleton.y = skeleton.spawnY; skeleton.hp = SKELETON_HP; skeleton.maxHp = SKELETON_HP; skeleton.targetPlayerId = ""; skeleton.frostedUntil = 0; skeleton.alive = true; }, SKELETON_RESPAWN_MS);
          }
        }
        return;
      }

      const boss = this.state.bosses.get(player.targetId);
      if (boss) {
        if (applyFrost(boss as any, player.targetId, boss.maxHp)) {
          if (boss.hp <= 0) {
            boss.alive = false;
            const bossId = player.targetId;
            player.targetId = "";
            player.xp += BOSS_XP;
            this.spawnGroundLoot(boss.x, boss.y, "boss", client.sessionId, randRange(BOSS_GOLD_MIN, BOSS_GOLD_MAX));
            checkLevelUp(player, this, client.sessionId);
            this.broadcast("boss_killed", { bossId, bossType: boss.bossType, killerId: client.sessionId, killerName: player.name, xp: BOSS_XP });
            this.broadcastKillAndQuest({ targetId: bossId, killerId: client.sessionId, killerName: player.name, xp: BOSS_XP });
            this.clock.setTimeout(() => { this.broadcast("boss_warning", { bossType: boss.bossType, message: `⚠️ The Dragon stirs in the wilderness...` }); }, BOSS_RESPAWN_MS - BOSS_SPAWN_ANNOUNCE_MS);
            this.clock.setTimeout(() => { boss.hp = BOSS_HP; boss.maxHp = BOSS_HP; boss.phase = 1; boss.x = boss.spawnX; boss.y = boss.spawnY; boss.targetPlayerId = ""; boss.frostedUntil = 0; boss.alive = true; this.broadcast("boss_spawn", { bossId: boss.id, bossType: boss.bossType }); }, BOSS_RESPAWN_MS);
          }
        }
        return;
      }
    });

    // ── Rain of Arrows (Ranger) — AOE damage around target ──
    this.onMessage("rain_of_arrows", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      if (player.playerClass !== "ranger") return;
      if (player.mp < RAIN_OF_ARROWS_COST) return;
      if (!player.targetId) return;
      const now = Date.now();
      if (getAbilityCooldown(client.sessionId, "rain_of_arrows") > now) return;

      const cfg = CLASS_CONFIG.ranger;
      const px = player.x, py = player.y;

      // Find the target to get center of AOE
      let centerX = 0, centerY = 0;
      let foundTarget = false;

      // Check all monster types for target
      const checkTarget = (collection: any, id: string) => {
        const m = collection.get(id);
        if (m && m.alive) { centerX = m.x; centerY = m.y; foundTarget = true; }
      };
      checkTarget(this.state.slimes, player.targetId);
      if (!foundTarget) checkTarget(this.state.wolves, player.targetId);
      if (!foundTarget) checkTarget(this.state.goblins, player.targetId);
      if (!foundTarget) checkTarget(this.state.skeletons, player.targetId);
      if (!foundTarget) checkTarget(this.state.bosses, player.targetId);
      if (!foundTarget) return;

      // Range check to target
      if (dist(px, py, centerX, centerY) > cfg.range) return;

      player.mp -= RAIN_OF_ARROWS_COST;
      setAbilityCooldown(client.sessionId, "rain_of_arrows", now + RAIN_OF_ARROWS_COOLDOWN_MS);

      const centerTX = Math.round(centerX / TILE_SIZE);
      const centerTY = Math.round(centerY / TILE_SIZE);
      let hitCount = 0;
      const baseDmg = Math.floor(player.attack * RAIN_OF_ARROWS_DAMAGE_MULT);

      // Hit all monsters in AOE range
      const hitMonster = (monster: any, mId: string, xpGain: number, goldMin: number, goldMax: number, respawnMs: number, lootTable: string, onDeath?: () => void) => {
        if (!monster.alive) return;
        const mx = Math.round(monster.x / TILE_SIZE);
        const my = Math.round(monster.y / TILE_SIZE);
        const d = Math.max(Math.abs(mx - centerTX), Math.abs(my - centerTY));
        if (d > RAIN_OF_ARROWS_RANGE) return;

        const damage = Math.max(1, baseDmg + Math.floor(Math.random() * 8) - 4);
        monster.hp = Math.max(0, monster.hp - damage);
        this.broadcast("hit", { targetId: mId, damage, attackerId: client.sessionId });
        hitCount++;

        if (monster.hp <= 0) {
          monster.alive = false;
          if (monster.targetPlayerId !== undefined) monster.targetPlayerId = "";
          if (player.targetId === mId) player.targetId = "";
          player.xp += xpGain;
          this.spawnGroundLoot(monster.x, monster.y, lootTable, client.sessionId, randRange(goldMin, goldMax));
          this.broadcastKillAndQuest({ targetId: mId, killerId: client.sessionId, killerName: player.name, xp: xpGain });
          if (onDeath) onDeath();
        }
      };

      this.state.slimes.forEach((slime, id) => {
        let sIdx = 0;
        const parts = id.split("_"); sIdx = parseInt(parts[1]) || 0;
        const xpGain = SLIME_TYPES[SLIME_SPAWNS[sIdx]?.type || 0]?.xp || 25;
        hitMonster(slime, id, xpGain, SLIME_GOLD_MIN, SLIME_GOLD_MAX, SLIME_RESPAWN_MS, "slime", () => {
          this.clock.setTimeout(() => { const spawn = SLIME_SPAWNS[sIdx]; if (spawn) { const type = SLIME_TYPES[spawn.type]; slime.x = spawn.x * TILE_SIZE; slime.y = spawn.y * TILE_SIZE; slime.hp = type.hp; slime.maxHp = type.hp; slime.targetPlayerId = ""; slime.alive = true; } }, SLIME_RESPAWN_MS);
        });
      });

      this.state.wolves.forEach((wolf, id) => {
        hitMonster(wolf, id, WOLF_XP, WOLF_GOLD_MIN, WOLF_GOLD_MAX, WOLF_RESPAWN_MS, "wolf", () => {
          this.clock.setTimeout(() => { wolf.x = wolf.spawnX; wolf.y = wolf.spawnY; wolf.hp = WOLF_HP; wolf.maxHp = WOLF_HP; wolf.targetPlayerId = ""; wolf.alive = true; }, WOLF_RESPAWN_MS);
        });
      });

      this.state.goblins.forEach((goblin, id) => {
        hitMonster(goblin, id, GOBLIN_XP, GOBLIN_GOLD_MIN, GOBLIN_GOLD_MAX, GOBLIN_RESPAWN_MS, "goblin", () => {
          this.clock.setTimeout(() => { goblin.x = goblin.spawnX; goblin.y = goblin.spawnY; goblin.hp = GOBLIN_HP; goblin.maxHp = GOBLIN_HP; goblin.targetPlayerId = ""; goblin.alive = true; }, GOBLIN_RESPAWN_MS);
        });
      });

      this.state.skeletons.forEach((skeleton, id) => {
        hitMonster(skeleton, id, SKELETON_XP, SKELETON_GOLD_MIN, SKELETON_GOLD_MAX, SKELETON_RESPAWN_MS, "skeleton", () => {
          this.clock.setTimeout(() => { skeleton.x = skeleton.spawnX; skeleton.y = skeleton.spawnY; skeleton.hp = SKELETON_HP; skeleton.maxHp = SKELETON_HP; skeleton.targetPlayerId = ""; skeleton.alive = true; }, SKELETON_RESPAWN_MS);
        });
      });

      // Also hit boss if in range
      this.state.bosses.forEach((boss, id) => {
        if (!boss.alive) return;
        const bx = Math.round(boss.x / TILE_SIZE);
        const by = Math.round(boss.y / TILE_SIZE);
        const d = Math.max(Math.abs(bx - centerTX), Math.abs(by - centerTY));
        if (d > RAIN_OF_ARROWS_RANGE) return;
        const damage = Math.max(1, baseDmg + Math.floor(Math.random() * 8) - 4);
        boss.hp = Math.max(0, boss.hp - damage);
        this.broadcast("hit", { targetId: id, damage, attackerId: client.sessionId });
        hitCount++;
        if (boss.hp > 0 && boss.hp <= boss.maxHp * BOSS_PHASE2_HP_RATIO && boss.phase === 1) {
          boss.phase = 2;
          this.broadcast("boss_enrage", { bossId: boss.id, bossType: boss.bossType });
        }
        if (boss.hp <= 0) {
          boss.alive = false;
          if (player.targetId === id) player.targetId = "";
          player.xp += BOSS_XP;
          this.spawnGroundLoot(boss.x, boss.y, "boss", client.sessionId, randRange(BOSS_GOLD_MIN, BOSS_GOLD_MAX));
          this.broadcast("boss_killed", { bossId: id, bossType: boss.bossType, killerId: client.sessionId, killerName: player.name, xp: BOSS_XP });
          this.broadcastKillAndQuest({ targetId: id, killerId: client.sessionId, killerName: player.name, xp: BOSS_XP });
          this.clock.setTimeout(() => { this.broadcast("boss_warning", { bossType: boss.bossType, message: `⚠️ The Dragon stirs...` }); }, BOSS_RESPAWN_MS - BOSS_SPAWN_ANNOUNCE_MS);
          this.clock.setTimeout(() => { boss.hp = BOSS_HP; boss.maxHp = BOSS_HP; boss.phase = 1; boss.x = boss.spawnX; boss.y = boss.spawnY; boss.targetPlayerId = ""; boss.alive = true; this.broadcast("boss_spawn", { bossId: boss.id, bossType: boss.bossType }); }, BOSS_RESPAWN_MS);
        }
      });

      checkLevelUp(player, this, client.sessionId);

      this.broadcast("rain_of_arrows_effect", { sessionId: client.sessionId, x: centerX, y: centerY, range: RAIN_OF_ARROWS_RANGE, hits: hitCount });
    });

    // ── Ability Cooldown Query — client can request current cooldowns ──
    this.onMessage("query_cooldowns", (client) => {
      const now = Date.now();
      const cds: Record<string, number> = {};
      const map = abilityCooldowns.get(client.sessionId);
      if (map) {
        map.forEach((until, ability) => {
          const remaining = Math.max(0, until - now);
          if (remaining > 0) cds[ability] = remaining;
        });
      }
      client.send("cooldowns", cds);
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
    // Send initial quest markers
    this.sendQuestMarkers(client, player);
    console.log(`${player.name} (${cls}) joined (${client.sessionId})`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) console.log(`${player.name} left (${client.sessionId})`);
    this.state.players.delete(client.sessionId);
    lastMoveTime.delete(client.sessionId);
    lastAutoAttackTime.delete(client.sessionId);
    npcDialogueIndex.delete(client.sessionId);
    abilityCooldowns.delete(client.sessionId);
  }

  onDispose() { console.log("GameRoom disposed"); }
}
