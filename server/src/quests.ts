// Quest definitions — each quest has an NPC giver, kill targets, and rewards

export interface QuestDef {
  id: string;
  name: string;
  description: string;
  npcId: string;          // NPC who gives & completes this quest
  killTarget: string;     // monster type: "slime" | "wolf" | "goblin" | "skeleton" | "boss"
  killCount: number;      // how many to kill
  requiredLevel: number;  // minimum player level to accept
  prerequisite?: string;  // quest ID that must be completed first
  rewards: {
    xp: number;
    gold: number;
    items?: Array<{ itemId: string; quantity: number }>;
  };
  icon: string;           // emoji for UI
  repeatCooldownMs?: number; // if set, quest can be repeated after this cooldown (0 = one-time)
}

export const QUESTS: Record<string, QuestDef> = {
  // ── Elder Oak's questline (beginner) ──
  slime_hunt: {
    id: "slime_hunt",
    name: "Slime Trouble",
    description: "The slimes are multiplying! Clear out 5 of them near the village.",
    npcId: "elder",
    killTarget: "slime",
    killCount: 5,
    requiredLevel: 1,
    rewards: { xp: 120, gold: 50 },
    icon: "🟢",
  },
  wolf_menace: {
    id: "wolf_menace",
    name: "Wolf Menace",
    description: "Wolves have been spotted in the forest. Slay 3 to secure the perimeter.",
    npcId: "elder",
    killTarget: "wolf",
    killCount: 3,
    requiredLevel: 3,
    prerequisite: "slime_hunt",
    rewards: { xp: 250, gold: 100, items: [{ itemId: "health_potion", quantity: 3 }] },
    icon: "🐺",
  },

  // ── Mira's questline ──
  goblin_raid: {
    id: "goblin_raid",
    name: "Goblin Raiders",
    description: "Goblins have been raiding our supply routes! Defeat 4 of them.",
    npcId: "innkeeper",
    killTarget: "goblin",
    killCount: 4,
    requiredLevel: 4,
    rewards: { xp: 300, gold: 120, items: [{ itemId: "mana_potion", quantity: 3 }] },
    icon: "👹",
  },

  // ── Forge's questline (harder) ──
  skeleton_scourge: {
    id: "skeleton_scourge",
    name: "Undead Scourge",
    description: "Skeletons have risen at the map's edges. Destroy 3 before they spread.",
    npcId: "blacksmith",
    killTarget: "skeleton",
    killCount: 3,
    requiredLevel: 6,
    rewards: { xp: 400, gold: 200, items: [{ itemId: "iron_sword", quantity: 1 }] },
    icon: "💀",
  },

  // ── Pip's legendary quest ──
  dragon_slayer: {
    id: "dragon_slayer",
    name: "Dragon Slayer",
    description: "The Dragon terrorizes the wilderness. Only the bravest can slay it.",
    npcId: "merchant",
    killTarget: "boss",
    killCount: 1,
    requiredLevel: 8,
    prerequisite: "skeleton_scourge",
    rewards: { xp: 1000, gold: 500, items: [{ itemId: "fire_staff", quantity: 1 }] },
    icon: "🐉",
  },

  // ── Old Gil's repeatable quests ──
  slime_bounty: {
    id: "slime_bounty",
    name: "Slime Bounty",
    description: "Old Gil pays for slime cleanup. Kill 8 slimes for a reward.",
    npcId: "fisherman",
    killTarget: "slime",
    killCount: 8,
    requiredLevel: 2,
    rewards: { xp: 100, gold: 80 },
    icon: "💰",
    repeatCooldownMs: 0, // repeatable immediately
  },
  wolf_bounty: {
    id: "wolf_bounty",
    name: "Wolf Bounty",
    description: "Old Gil needs wolf pelts. Slay 5 wolves.",
    npcId: "fisherman",
    killTarget: "wolf",
    killCount: 5,
    requiredLevel: 3,
    prerequisite: "slime_bounty",
    rewards: { xp: 200, gold: 150 },
    icon: "💰",
    repeatCooldownMs: 0,
  },
  spider_queen: {
    id: "spider_queen",
    name: "The Spider Queen",
    description: "Old Cragbeard has asked you to venture into the caves and slay the Spider Queen.",
    npcId: "cragbeard",
    killTarget: "spider_queen",
    killCount: 1,
    requiredLevel: 5,
    rewards: {
      xp: 500,
      gold: 300,
      items: [{ itemId: "venom_sac", quantity: 3 }],
    },
    icon: "🕷️",
  },
};

// Get quests available from a specific NPC for a player
export function getAvailableQuests(
  npcId: string,
  playerLevel: number,
  completedQuests: Set<string>,
  activeQuests: Set<string>
): QuestDef[] {
  return Object.values(QUESTS).filter(q => {
    if (q.npcId !== npcId) return false;
    if (playerLevel < q.requiredLevel) return false;
    if (q.prerequisite && !completedQuests.has(q.prerequisite)) return false;
    if (activeQuests.has(q.id)) return false;
    // One-time quests: skip if completed and not repeatable
    if (completedQuests.has(q.id) && q.repeatCooldownMs === undefined) return false;
    return true;
  });
}

// Get quests that can be turned in at this NPC
export function getTurnInQuests(
  npcId: string,
  activeQuests: Map<string, { progress: number }>
): QuestDef[] {
  return Object.values(QUESTS).filter(q => {
    if (q.npcId !== npcId) return false;
    const active = activeQuests.get(q.id);
    if (!active) return false;
    return active.progress >= q.killCount;
  });
}
