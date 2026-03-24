export type EquipSlot = "weapon" | "helmet" | "chest" | "legs" | "boots";

export interface ItemDef {
  id: string;
  type: "consumable" | "weapon" | "armor" | "material";
  name: string;
  description: string;
  stackable: boolean;
  maxStack: number;
  buyPrice: number;   // 0 = can't buy
  sellPrice: number;  // 0 = can't sell
  effect?: {
    hp?: number;
    mp?: number;
    atk?: number;
    range?: number;
  };
  equipSlot?: EquipSlot;
  equipBonus?: {
    atk?: number;
    def?: number;
    maxHp?: number;
    maxMp?: number;
  };
  icon?: string; // emoji icon for client
  dropWeight?: number; // relative drop chance (higher = more common)
}

export const ITEMS: Record<string, ItemDef> = {
  health_potion: {
    id: "health_potion",
    type: "consumable",
    name: "Health Potion",
    description: "Restores 50 HP instantly.",
    stackable: true,
    maxStack: 50,
    buyPrice: 50,
    sellPrice: 25,
    effect: { hp: 50 },
    icon: "❤️",
  },
  mana_potion: {
    id: "mana_potion",
    type: "consumable",
    name: "Mana Potion",
    description: "Restores 30 MP instantly.",
    stackable: true,
    maxStack: 50,
    buyPrice: 30,
    sellPrice: 15,
    effect: { mp: 30 },
    icon: "💙",
  },
  // ── Weapons ──
  wooden_sword: {
    id: "wooden_sword",
    type: "weapon",
    name: "Wooden Sword",
    description: "A basic training sword.",
    stackable: false, maxStack: 1,
    buyPrice: 100, sellPrice: 40,
    equipSlot: "weapon",
    equipBonus: { atk: 5 },
    icon: "🗡️",
    dropWeight: 30,
  },
  iron_sword: {
    id: "iron_sword",
    type: "weapon",
    name: "Iron Sword",
    description: "A sturdy iron blade.",
    stackable: false, maxStack: 1,
    buyPrice: 300, sellPrice: 120,
    equipSlot: "weapon",
    equipBonus: { atk: 12 },
    icon: "⚔️",
    dropWeight: 15,
  },
  hunters_bow: {
    id: "hunters_bow",
    type: "weapon",
    name: "Hunter's Bow",
    description: "A finely crafted bow for rangers.",
    stackable: false, maxStack: 1,
    buyPrice: 250, sellPrice: 100,
    equipSlot: "weapon",
    equipBonus: { atk: 10 },
    icon: "🏹",
    dropWeight: 15,
  },
  fire_staff: {
    id: "fire_staff",
    type: "weapon",
    name: "Fire Staff",
    description: "Crackles with arcane energy.",
    stackable: false, maxStack: 1,
    buyPrice: 0, sellPrice: 200,
    equipSlot: "weapon",
    equipBonus: { atk: 18, maxMp: 20 },
    icon: "🔥",
    dropWeight: 5,
  },
  // ── Armor ──
  leather_helmet: {
    id: "leather_helmet",
    type: "armor",
    name: "Leather Cap",
    description: "Basic head protection.",
    stackable: false, maxStack: 1,
    buyPrice: 80, sellPrice: 30,
    equipSlot: "helmet",
    equipBonus: { def: 3, maxHp: 10 },
    icon: "🪖",
    dropWeight: 25,
  },
  iron_helmet: {
    id: "iron_helmet",
    type: "armor",
    name: "Iron Helm",
    description: "Solid iron headgear.",
    stackable: false, maxStack: 1,
    buyPrice: 0, sellPrice: 100,
    equipSlot: "helmet",
    equipBonus: { def: 7, maxHp: 25 },
    icon: "⛑️",
    dropWeight: 8,
  },
  leather_chest: {
    id: "leather_chest",
    type: "armor",
    name: "Leather Vest",
    description: "Light but protective.",
    stackable: false, maxStack: 1,
    buyPrice: 120, sellPrice: 50,
    equipSlot: "chest",
    equipBonus: { def: 5, maxHp: 15 },
    icon: "🦺",
    dropWeight: 20,
  },
  chain_chest: {
    id: "chain_chest",
    type: "armor",
    name: "Chainmail",
    description: "Interlocking metal rings.",
    stackable: false, maxStack: 1,
    buyPrice: 0, sellPrice: 160,
    equipSlot: "chest",
    equipBonus: { def: 10, maxHp: 40 },
    icon: "🛡️",
    dropWeight: 6,
  },
  leather_legs: {
    id: "leather_legs",
    type: "armor",
    name: "Leather Pants",
    description: "Flexible leg armor.",
    stackable: false, maxStack: 1,
    buyPrice: 90, sellPrice: 35,
    equipSlot: "legs",
    equipBonus: { def: 4, maxHp: 10 },
    icon: "👖",
    dropWeight: 20,
  },
  iron_legs: {
    id: "iron_legs",
    type: "armor",
    name: "Iron Greaves",
    description: "Heavy leg protection.",
    stackable: false, maxStack: 1,
    buyPrice: 0, sellPrice: 120,
    equipSlot: "legs",
    equipBonus: { def: 8, maxHp: 30 },
    icon: "🦿",
    dropWeight: 8,
  },
  sandals: {
    id: "sandals",
    type: "armor",
    name: "Traveler's Sandals",
    description: "Comfortable footwear.",
    stackable: false, maxStack: 1,
    buyPrice: 60, sellPrice: 20,
    equipSlot: "boots",
    equipBonus: { def: 2 },
    icon: "👡",
    dropWeight: 25,
  },
  iron_boots: {
    id: "iron_boots",
    type: "armor",
    name: "Iron Boots",
    description: "Sturdy metal boots.",
    stackable: false, maxStack: 1,
    buyPrice: 0, sellPrice: 80,
    equipSlot: "boots",
    equipBonus: { def: 5, maxHp: 15 },
    icon: "🥾",
    dropWeight: 10,
  },
  // ── Fish ──
  small_fish: {
    id: "small_fish",
    type: "consumable",
    name: "Small Fish",
    description: "A common freshwater fish. Restores 20 HP.",
    stackable: true, maxStack: 20,
    buyPrice: 0, sellPrice: 10,
    effect: { hp: 20 },
    icon: "🐟",
  },
  big_fish: {
    id: "big_fish",
    type: "consumable",
    name: "Big Fish",
    description: "A hefty catch! Restores 60 HP.",
    stackable: true, maxStack: 20,
    buyPrice: 0, sellPrice: 30,
    effect: { hp: 60 },
    icon: "🐠",
  },
  golden_fish: {
    id: "golden_fish",
    type: "consumable",
    name: "Golden Fish",
    description: "A legendary catch that glimmers with magic. Restores 100 HP and 50 MP.",
    stackable: true, maxStack: 10,
    buyPrice: 0, sellPrice: 100,
    effect: { hp: 100, mp: 50 },
    icon: "✨🐟",
  },
  treasure_chest: {
    id: "treasure_chest",
    type: "material",
    name: "Sunken Treasure",
    description: "A waterlogged chest containing 200 gold!",
    stackable: true, maxStack: 5,
    buyPrice: 0, sellPrice: 200,
    icon: "🧰",
  },
};

export const SHOP_ITEMS = ["health_potion", "mana_potion", "wooden_sword", "leather_helmet", "leather_chest", "leather_legs", "sandals"];

export const INVENTORY_SIZE = 20;

// Loot tables per monster type
export interface LootEntry { itemId: string; chance: number; minQty?: number; maxQty?: number; }

export const LOOT_TABLES: Record<string, LootEntry[]> = {
  slime: [
    { itemId: "health_potion", chance: 0.20, minQty: 1, maxQty: 2 },
    { itemId: "mana_potion", chance: 0.10 },
    { itemId: "leather_helmet", chance: 0.03 },
    { itemId: "sandals", chance: 0.04 },
  ],
  wolf: [
    { itemId: "health_potion", chance: 0.25, minQty: 1, maxQty: 3 },
    { itemId: "mana_potion", chance: 0.15 },
    { itemId: "wooden_sword", chance: 0.06 },
    { itemId: "hunters_bow", chance: 0.04 },
    { itemId: "leather_chest", chance: 0.05 },
    { itemId: "leather_legs", chance: 0.05 },
  ],
  goblin: [
    { itemId: "health_potion", chance: 0.20 },
    { itemId: "iron_sword", chance: 0.04 },
    { itemId: "iron_helmet", chance: 0.03 },
    { itemId: "iron_boots", chance: 0.04 },
    { itemId: "leather_chest", chance: 0.06 },
  ],
  skeleton: [
    { itemId: "mana_potion", chance: 0.25, minQty: 1, maxQty: 2 },
    { itemId: "iron_sword", chance: 0.06 },
    { itemId: "chain_chest", chance: 0.03 },
    { itemId: "iron_legs", chance: 0.04 },
    { itemId: "iron_helmet", chance: 0.04 },
    { itemId: "fire_staff", chance: 0.01 },
  ],
  boss: [
    { itemId: "health_potion", chance: 0.80, minQty: 3, maxQty: 5 },
    { itemId: "mana_potion", chance: 0.60, minQty: 2, maxQty: 4 },
    { itemId: "fire_staff", chance: 0.08 },
    { itemId: "chain_chest", chance: 0.12 },
    { itemId: "iron_helmet", chance: 0.15 },
    { itemId: "iron_legs", chance: 0.12 },
    { itemId: "iron_boots", chance: 0.15 },
    { itemId: "iron_sword", chance: 0.10 },
  ],
};

export function rollLoot(table: string): Array<{ itemId: string; quantity: number }> {
  const entries = LOOT_TABLES[table];
  if (!entries) return [];
  const drops: Array<{ itemId: string; quantity: number }> = [];
  for (const entry of entries) {
    if (Math.random() < entry.chance) {
      const qty = entry.minQty && entry.maxQty
        ? Math.floor(Math.random() * (entry.maxQty - entry.minQty + 1)) + entry.minQty
        : 1;
      drops.push({ itemId: entry.itemId, quantity: qty });
    }
  }
  return drops;
}
