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
  },
};

export const SHOP_ITEMS = ["health_potion", "mana_potion"];

export const INVENTORY_SIZE = 20;
