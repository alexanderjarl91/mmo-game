import { useEffect, useRef, useState, useCallback } from "react";
import { joinGame, sendMove, sendSetTarget, sendClearTarget } from "../lib/network";
import { sfxHit, sfxPlayerHit, sfxKill, sfxLevelUp, sfxHeal, sfxLoot, sfxDeath, sfxArrow, sfxCleave, sfxChat, sfxEquip, toggleMute, isMuted, startAmbient } from "../lib/sound";
import type { Room } from "colyseus.js";

/* ── Types ─────────────────────────────────────────── */

interface PlayerData {
  serverX: number; serverY: number;
  displayX: number; displayY: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  moveStartTime: number;
  color: string; name: string;
  direction: string; moving: boolean;
  hp: number; maxHp: number;
  mp: number; maxMp: number;
  xp: number; level: number;
  playerClass: string;
  targetId: string;
  isHardcore: boolean;
  gold: number;
  inventory: Array<{ itemId: string; quantity: number }>;
  deathTime: number; // when hp first hit 0
  equipWeapon: string;
  equipHelmet: string;
  equipChest: string;
  equipLegs: string;
  equipBoots: string;
  defense: number;
  statusEffect: string;
  statusEffectEnd: number;
  killStreak: number;
  bestKillStreak: number;
}

interface SlimeData {
  displayX: number; displayY: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  moveStartTime: number;
  serverX: number; serverY: number;
  hp: number; maxHp: number;
  color: string; size: string;
  alive: boolean;
  hitTime: number; // for flash effect
}

interface WolfData {
  displayX: number; displayY: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  moveStartTime: number;
  serverX: number; serverY: number;
  hp: number; maxHp: number;
  alive: boolean;
  targetPlayerId: string;
  hitTime: number;
}

interface GoblinData {
  displayX: number; displayY: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  moveStartTime: number;
  serverX: number; serverY: number;
  hp: number; maxHp: number;
  alive: boolean;
  variant: string;
  targetPlayerId: string;
  hitTime: number;
}

interface SkeletonData {
  displayX: number; displayY: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  moveStartTime: number;
  serverX: number; serverY: number;
  hp: number; maxHp: number;
  alive: boolean;
  targetPlayerId: string;
  hitTime: number;
}

interface BossData {
  displayX: number; displayY: number;
  fromX: number; fromY: number;
  toX: number; toY: number;
  moveStartTime: number;
  serverX: number; serverY: number;
  hp: number; maxHp: number;
  alive: boolean;
  bossType: string;
  targetPlayerId: string;
  phase: number;
  hitTime: number;
}

interface ChatBubble { sessionId: string; message: string; time: number; }
interface EmoteBubble { sessionId: string; emote: string; time: number; }
interface NPCData { id: string; x: number; y: number; name: string; color: string; direction: string; dialogue: string[]; }
interface NPCDialogue { npcId: string; name: string; message: string; time: number; }
interface DamageNumber { x: number; y: number; damage: number; time: number; color?: string; prefix?: string; }
interface KillFeed { text: string; time: number; }

/* ── Constants ─────────────────────────────────────── */

const TILE_SIZE = 64;
const MOVE_DURATION = 110;
const KEY_REPEAT_MS = 120;
const CHAT_DURATION = 4000;
const EMOTE_DURATION = 2000;
const NPC_DIALOGUE_DURATION = 5000;
const DAMAGE_DURATION = 1200;

const SPRITE_W = 64, SPRITE_H = 64, WALK_FRAMES = 9, ANIM_SPEED = 80;
const DIR_ROW: Record<string, number> = { up: 8, left: 9, down: 10, right: 11 };
const TILE = { GRASS: 0, PATH: 1, WATER: 2, TREE: 3, ROCK: 4, FLOWERS: 5, BRIDGE: 6, WALL: 7, FLOOR: 8, TEMPLE: 9 };
const EMOTES = ["👋", "😂", "❤️", "⚔️", "🎉"];
const HEAL_COST = 20;
const POTION_COOLDOWN_MS = 2000;

// Item definitions (mirror server)
type EquipSlot = "weapon" | "helmet" | "chest" | "legs" | "boots";
const ITEMS: Record<string, { name: string; icon: string; buyPrice: number; sellPrice: number; effect?: { hp?: number; mp?: number }; equipSlot?: EquipSlot; equipBonus?: { atk?: number; def?: number; maxHp?: number; maxMp?: number } }> = {
  health_potion: { name: "Health Potion", icon: "❤️", buyPrice: 50, sellPrice: 25, effect: { hp: 50 } },
  mana_potion: { name: "Mana Potion", icon: "💙", buyPrice: 30, sellPrice: 15, effect: { mp: 30 } },
  wooden_sword: { name: "Wooden Sword", icon: "🗡️", buyPrice: 100, sellPrice: 40, equipSlot: "weapon", equipBonus: { atk: 5 } },
  iron_sword: { name: "Iron Sword", icon: "⚔️", buyPrice: 300, sellPrice: 120, equipSlot: "weapon", equipBonus: { atk: 12 } },
  hunters_bow: { name: "Hunter's Bow", icon: "🏹", buyPrice: 250, sellPrice: 100, equipSlot: "weapon", equipBonus: { atk: 10 } },
  fire_staff: { name: "Fire Staff", icon: "🔥", buyPrice: 0, sellPrice: 200, equipSlot: "weapon", equipBonus: { atk: 18, maxMp: 20 } },
  leather_helmet: { name: "Leather Cap", icon: "🪖", buyPrice: 80, sellPrice: 30, equipSlot: "helmet", equipBonus: { def: 3, maxHp: 10 } },
  iron_helmet: { name: "Iron Helm", icon: "⛑️", buyPrice: 0, sellPrice: 100, equipSlot: "helmet", equipBonus: { def: 7, maxHp: 25 } },
  leather_chest: { name: "Leather Vest", icon: "🦺", buyPrice: 120, sellPrice: 50, equipSlot: "chest", equipBonus: { def: 5, maxHp: 15 } },
  chain_chest: { name: "Chainmail", icon: "🛡️", buyPrice: 0, sellPrice: 160, equipSlot: "chest", equipBonus: { def: 10, maxHp: 40 } },
  leather_legs: { name: "Leather Pants", icon: "👖", buyPrice: 90, sellPrice: 35, equipSlot: "legs", equipBonus: { def: 4, maxHp: 10 } },
  iron_legs: { name: "Iron Greaves", icon: "🦿", buyPrice: 0, sellPrice: 120, equipSlot: "legs", equipBonus: { def: 8, maxHp: 30 } },
  sandals: { name: "Traveler's Sandals", icon: "👡", buyPrice: 60, sellPrice: 20, equipSlot: "boots", equipBonus: { def: 2 } },
  iron_boots: { name: "Iron Boots", icon: "🥾", buyPrice: 0, sellPrice: 80, equipSlot: "boots", equipBonus: { def: 5, maxHp: 15 } },
  small_fish: { name: "Small Fish", icon: "🐟", buyPrice: 0, sellPrice: 10, effect: { hp: 20 } },
  big_fish: { name: "Big Fish", icon: "🐠", buyPrice: 0, sellPrice: 30, effect: { hp: 60 } },
  golden_fish: { name: "Golden Fish", icon: "✨🐟", buyPrice: 0, sellPrice: 100, effect: { hp: 100, mp: 50 } },
  treasure_chest: { name: "Sunken Treasure", icon: "🧰", buyPrice: 0, sellPrice: 200 },
};
const SHOP_ITEMS = ["health_potion", "mana_potion", "wooden_sword", "leather_helmet", "leather_chest", "leather_legs", "sandals"];

// Tibia XP formula
function xpForLevel(level: number): number {
  return Math.floor((50 / 3) * (level * level * level - 6 * level * level + 17 * level - 12));
}

interface Projectile { fromX: number; fromY: number; toX: number; toY: number; time: number; }
interface LevelUpEffect { sessionId: string; level: number; time: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }

interface Props { playerName: string; playerClass: string; isHardcore: boolean; }

export default function GameCanvas({ playerName, playerClass, isHardcore }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<Room | null>(null);
  const playersRef = useRef<Map<string, PlayerData>>(new Map());
  const slimesRef = useRef<Map<string, SlimeData>>(new Map());
  const wolvesRef = useRef<Map<string, WolfData>>(new Map());
  const goblinsRef = useRef<Map<string, GoblinData>>(new Map());
  const skeletonsRef = useRef<Map<string, SkeletonData>>(new Map());
  const bossesRef = useRef<Map<string, BossData>>(new Map());
  const droppedItemsRef = useRef<Map<string, { id: string; itemId: string; quantity: number; x: number; y: number; droppedAt: number }>>(new Map());
  const worldEventsRef = useRef<Map<string, { id: string; eventType: string; x: number; y: number; spawnedAt: number; expiresAt: number; active: boolean; hp: number; maxHp: number }>>(new Map());
  const worldEventNotifsRef = useRef<Array<{ message: string; time: number; color: string }>>([]);
  const streakBannerRef = useRef<{ title: string; name: string; streak: number; time: number; xpBonus: number; goldBonus: number; isMine: boolean } | null>(null);
  const lastAutoPickupRef = useRef(0);
  const fishingRef = useRef<{ active: boolean; castTime: number; duration: number; result: string | null; resultTime: number }>({ active: false, castTime: 0, duration: 0, result: null, resultTime: 0 });
  const sessionIdRef = useRef("");
  const keysRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [questLogOpen, setQuestLogOpen] = useState(false);
  const [questDialogOpen, setQuestDialogOpen] = useState(false);
  const [questDialogData, setQuestDialogData] = useState<{ npcId: string; npcName: string; available: any[]; turnIn: any[] } | null>(null);
  const questTrackerRef = useRef<Array<{ questId: string; name: string; icon: string; progress: number; required: number; completed: boolean; killTarget: string }>>([]);
  const questNotifRef = useRef<Array<{ text: string; time: number; color: string }>>([]);
  const npcQuestMarkersRef = useRef<Map<string, "available" | "turnin" | "">>(new Map());
  const lastPotionUse = useRef(0);
  const [chatText, setChatText] = useState("");
  const [soundMuted, setSoundMuted] = useState(false);
  const [myStats, setMyStats] = useState<{ hp: number; maxHp: number; xp: number; level: number; playerClass: string; targetId: string; isHardcore: boolean; gold: number } | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const warriorSpriteRef = useRef<HTMLImageElement | null>(null);
  const rangerSpriteRef = useRef<HTMLImageElement | null>(null);
  const grassTileRef = useRef<HTMLImageElement | null>(null);
  const grassTile2Ref = useRef<HTMLImageElement | null>(null);
  const tileCacheRef = useRef<HTMLCanvasElement | null>(null);

  const lastMoveTimeRef = useRef(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const dpadRef = useRef({ dx: 0, dy: 0 });
  const [isMobile, setIsMobile] = useState(false);

  const worldMapRef = useRef<number[][] | null>(null);
  const npcsRef = useRef<NPCData[]>([]);
  const mapSizeRef = useRef({ w: 64, h: 64 });

  const chatBubblesRef = useRef<ChatBubble[]>([]);
  const emoteBubblesRef = useRef<EmoteBubble[]>([]);
  const npcDialogueRef = useRef<NPCDialogue | null>(null);
  const damageNumbersRef = useRef<DamageNumber[]>([]);
  const killFeedRef = useRef<KillFeed[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const lootNotifRef = useRef<Array<{ text: string; time: number }>>([]);
  const levelUpEffectsRef = useRef<LevelUpEffect[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const cameraShakeRef = useRef<{ intensity: number; time: number }>({ intensity: 0, time: 0 });
  // Ability cooldown tracking (client-side mirror)
  const abilityCooldownsRef = useRef<Map<string, number>>(new Map()); // ability -> end timestamp
  const shieldWallEffectsRef = useRef<Array<{ sessionId: string; time: number; duration: number }>>([]);
  const warCryEffectsRef = useRef<Array<{ x: number; y: number; time: number; range: number }>>([]);
  const frostEffectsRef = useRef<Array<{ targetId: string; time: number; duration: number }>>([]);
  const rainEffectsRef = useRef<Array<{ x: number; y: number; time: number; range: number; hits: number }>>([]);

  useEffect(() => { setIsMobile("ontouchstart" in window || navigator.maxTouchPoints > 0); }, []);

  /* ── Assets ─────────────────────────────────────────── */

  useEffect(() => {
    const load = (src: string): Promise<HTMLImageElement> =>
      new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(img); img.src = src; });
    Promise.all([load("/assets/warrior.png"), load("/assets/ranger.png"), load("/assets/character.png"), load("/assets/grass.png"), load("/assets/grass2.png")]).then(([warrior, ranger, npc, grass, grass2]) => {
      warriorSpriteRef.current = warrior.complete && warrior.naturalWidth ? warrior : null;
      rangerSpriteRef.current = ranger.complete && ranger.naturalWidth ? ranger : null;
      npcSpriteRef.current = npc.complete && npc.naturalWidth ? npc : null;
      grassTileRef.current = grass.complete && grass.naturalWidth ? grass : null;
      grassTile2Ref.current = grass2.complete && grass2.naturalWidth ? grass2 : null;
    });
  }, []);

  const npcSpriteRef = useRef<HTMLImageElement | null>(null);
  const tintCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const getClassSprite = (cls: string): HTMLImageElement | null => {
    return cls === "ranger" ? rangerSpriteRef.current : warriorSpriteRef.current;
  };

  const getTintedSprite = (color: string): HTMLCanvasElement | null => {
    const cached = tintCacheRef.current.get(color);
    if (cached) return cached;
    const src = npcSpriteRef.current;
    if (!src) return null;
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    tintCacheRef.current.set(color, c);
    return c;
  };

  /* ── Tile cache ─────────────────────────────────────── */

  const buildTileCache = useCallback(() => {
    const map = worldMapRef.current;
    if (!map) return;
    const time = 0; // Static snapshot for tile cache (no animation)
    const mw = mapSizeRef.current.w, mh = mapSizeRef.current.h;
    const c = document.createElement("canvas");
    c.width = mw * TILE_SIZE; c.height = mh * TILE_SIZE;
    const ctx = c.getContext("2d")!;
    const grass = grassTileRef.current;
    const grass2 = grassTile2Ref.current;

    for (let ty = 0; ty < mh; ty++) {
      for (let tx = 0; tx < mw; tx++) {
        const px = tx * TILE_SIZE, py = ty * TILE_SIZE;
        const tile = map[ty]?.[tx] ?? 0;
        const variant = ((tx * 7 + ty * 13) & 3) === 0;
        if (grass) {
          ctx.drawImage((variant && grass2) ? grass2 : grass, px, py, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = "#2d5a1e"; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        switch (tile) {
          case TILE.PATH:
            ctx.fillStyle = "rgba(194,164,110,0.7)"; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = "rgba(160,130,80,0.3)"; ctx.fillRect(px, py, TILE_SIZE, 2); ctx.fillRect(px, py, 2, TILE_SIZE);
            break;
          case TILE.WATER: {
            // Animated water with shifting colors
            const waterPhase = (time / 2000 + (tx * 0.3 + ty * 0.2)) % 1;
            const waterR = 20 + Math.sin(waterPhase * Math.PI * 2) * 10;
            const waterG = 80 + Math.sin(waterPhase * Math.PI * 2 + 1) * 20;
            const waterB = 180 + Math.sin(waterPhase * Math.PI * 2 + 2) * 20;
            ctx.fillStyle = `rgba(${waterR},${waterG},${waterB},0.8)`;
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            // Animated wave ripples
            ctx.strokeStyle = `rgba(150,210,255,${0.3 + Math.sin(time / 800 + tx) * 0.15})`;
            ctx.lineWidth = 1;
            for (let r = 0; r < 3; r++) {
              const waveOffset = Math.sin(time / 600 + tx * 2 + r) * 4;
              const ry = py + 12 + r * 18;
              ctx.beginPath();
              ctx.moveTo(px + 4, ry + waveOffset);
              ctx.quadraticCurveTo(px + 32, ry - 6 + waveOffset + Math.sin(time / 500 + r) * 3, px + 60, ry + waveOffset);
              ctx.stroke();
            }
            // Sparkle on water
            if (Math.sin(time / 300 + tx * 7 + ty * 11) > 0.92) {
              ctx.fillStyle = "rgba(255,255,255,0.6)";
              ctx.beginPath();
              ctx.arc(px + 20 + Math.sin(tx * 3) * 15, py + 20 + Math.cos(ty * 5) * 15, 1.5, 0, Math.PI * 2);
              ctx.fill();
            }
            break;
          }
          case TILE.TREE: {
            // Swaying tree
            const sway = Math.sin(time / 1200 + tx * 2.7 + ty * 1.3) * 2;
            // Trunk
            ctx.fillStyle = "#5D4037";
            ctx.fillRect(px + 24, py + 32, 16, 28);
            // Foliage (swaying)
            ctx.fillStyle = "rgba(0,80,0,0.9)";
            ctx.beginPath(); ctx.arc(px + 32 + sway, py + 24, 22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(50,160,50,0.8)";
            ctx.beginPath(); ctx.arc(px + 30 + sway * 1.2, py + 20, 18, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(100,200,80,0.5)";
            ctx.beginPath(); ctx.arc(px + 26 + sway * 1.5, py + 16, 8, 0, Math.PI * 2); ctx.fill();
            break;
          }
          case TILE.ROCK:
            ctx.fillStyle = "#757575"; ctx.beginPath(); ctx.ellipse(px + 32, py + 38, 24, 18, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#9E9E9E"; ctx.beginPath(); ctx.ellipse(px + 28, py + 34, 18, 14, -0.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#BDBDBD"; ctx.beginPath(); ctx.ellipse(px + 26, py + 32, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
            break;
          case TILE.FLOWERS: {
            const fc = ["#FF5252", "#FFEB3B", "#E040FB", "#FF6D00", "#69F0AE"];
            for (let f = 0; f < 6; f++) {
              const flowerSway = Math.sin(time / 800 + f * 1.5 + tx * 3) * 2;
              const fx = px + 10 + ((f * 17) % 44) + flowerSway, fy = py + 10 + ((f * 23) % 44);
              // Stem
              ctx.strokeStyle = "#4CAF50"; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(fx, fy + 4); ctx.lineTo(fx - flowerSway * 0.3, fy + 10); ctx.stroke();
              // Petals
              ctx.fillStyle = fc[f % fc.length]; ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = "#FFFF00"; ctx.beginPath(); ctx.arc(fx, fy, 2, 0, Math.PI * 2); ctx.fill();
            }
            break;
          }
          case TILE.BRIDGE:
            ctx.fillStyle = "rgba(30,100,200,0.75)"; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = "#8D6E63"; ctx.fillRect(px + 8, py, TILE_SIZE - 16, TILE_SIZE);
            ctx.strokeStyle = "#6D4C41"; ctx.lineWidth = 1;
            for (let p = 0; p < 4; p++) { const ly = py + 8 + p * 16; ctx.beginPath(); ctx.moveTo(px + 8, ly); ctx.lineTo(px + TILE_SIZE - 8, ly); ctx.stroke(); }
            break;
          case TILE.WALL:
            ctx.fillStyle = "#795548"; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.strokeStyle = "#5D4037"; ctx.lineWidth = 1;
            for (let by = 0; by < 4; by++) { const brickY = py + by * 16; ctx.strokeRect(px, brickY, TILE_SIZE, 16); const off = (by % 2) * 32; ctx.beginPath(); ctx.moveTo(px + 32 + off, brickY); ctx.lineTo(px + 32 + off, brickY + 16); ctx.stroke(); }
            break;
          case TILE.FLOOR:
            ctx.fillStyle = "#A1887F"; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.strokeStyle = "#8D6E63"; ctx.lineWidth = 1; ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            break;
          case TILE.TEMPLE:
            // Golden/holy floor
            ctx.fillStyle = "#F5E6CA"; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.strokeStyle = "#D4AF37"; ctx.lineWidth = 1; ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            // Cross/star pattern
            ctx.strokeStyle = "rgba(212,175,55,0.4)"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(px + TILE_SIZE / 2, py + 8); ctx.lineTo(px + TILE_SIZE / 2, py + TILE_SIZE - 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px + 8, py + TILE_SIZE / 2); ctx.lineTo(px + TILE_SIZE - 8, py + TILE_SIZE / 2); ctx.stroke();
            break;
        }
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, mw * TILE_SIZE, mh * TILE_SIZE);
    tileCacheRef.current = c;
  }, []);

  /* ── Helpers ────────────────────────────────────────── */

  const startMove = (fromX: number, fromY: number, toX: number, toY: number) => ({
    fromX, fromY, toX, toY, moveStartTime: performance.now()
  });

  const getDisplayPos = (from: number, to: number, startTime: number, now: number) => {
    if (startTime === 0) return to;
    const t = Math.min((now - startTime) / MOVE_DURATION, 1);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return from + (to - from) * ease;
  };

  /* ── Server connection ──────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    joinGame(playerName, playerClass, isHardcore).then((room) => {
      if (cancelled) { room.leave(); return; }
      roomRef.current = room;
      sessionIdRef.current = room.sessionId;
      setConnected(true);

      room.onMessage("world_data", (data) => {
        worldMapRef.current = data.map;
        npcsRef.current = data.npcs || [];
        mapSizeRef.current = { w: data.mapW, h: data.mapH };
        setTimeout(() => buildTileCache(), 200);
      });

      room.onMessage("chat", (data: ChatBubble) => {
        chatBubblesRef.current.push({ ...data, time: performance.now() });
        if (chatBubblesRef.current.length > 20) chatBubblesRef.current.shift();
        sfxChat();
      });

      room.onMessage("emote", (data: EmoteBubble) => {
        emoteBubblesRef.current.push({ ...data, time: performance.now() });
        if (emoteBubblesRef.current.length > 20) emoteBubblesRef.current.shift();
      });

      room.onMessage("npc_dialogue", (data: any) => {
        npcDialogueRef.current = { ...data, time: performance.now() };
      });

      room.onMessage("hit", (data: { targetId: string; damage: number; x?: number; y?: number }) => {
        const slime = slimesRef.current.get(data.targetId);
        if (slime) {
          slime.hitTime = performance.now();
          damageNumbersRef.current.push({
            x: slime.displayX + TILE_SIZE / 2,
            y: slime.displayY,
            damage: data.damage,
            time: performance.now(),
            color: slime.color,
          });
          for (let i = 0; i < 4; i++) { particlesRef.current.push({ x: slime.displayX + TILE_SIZE / 2, y: slime.displayY, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2, life: 15 + Math.random() * 10, maxLife: 25, color: slime.color, size: 2 }); }
        }
        const wolf = wolvesRef.current.get(data.targetId);
        if (wolf) {
          wolf.hitTime = performance.now();
          damageNumbersRef.current.push({
            x: wolf.displayX + TILE_SIZE / 2,
            y: wolf.displayY,
            damage: data.damage,
            time: performance.now(),
            color: "#ff6b6b",
          });
          for (let i = 0; i < 5; i++) { particlesRef.current.push({ x: wolf.displayX + TILE_SIZE / 2, y: wolf.displayY, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, life: 20 + Math.random() * 15, maxLife: 35, color: "#cc3333", size: 2.5 }); }
        }
        // Goblin hit
        const goblin = goblinsRef.current.get(data.targetId);
        if (goblin) {
          goblin.hitTime = performance.now();
          damageNumbersRef.current.push({ x: goblin.displayX + TILE_SIZE / 2, y: goblin.displayY, damage: data.damage, time: performance.now(), color: "#7dcea0" });
          // Hit particles
          for (let i = 0; i < 5; i++) { particlesRef.current.push({ x: goblin.displayX + TILE_SIZE / 2, y: goblin.displayY, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, life: 20 + Math.random() * 15, maxLife: 35, color: "#4a8c3f", size: 2 }); }
        }
        // Skeleton hit
        const skel = skeletonsRef.current.get(data.targetId);
        if (skel) {
          skel.hitTime = performance.now();
          damageNumbersRef.current.push({ x: skel.displayX + TILE_SIZE / 2, y: skel.displayY, damage: data.damage, time: performance.now(), color: "#bdc3c7" });
          // Bone fragment particles
          for (let i = 0; i < 4; i++) { particlesRef.current.push({ x: skel.displayX + TILE_SIZE / 2, y: skel.displayY, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2.5, life: 15 + Math.random() * 10, maxLife: 25, color: "#ecf0f1", size: 1.5 }); }
        }
        // Boss hit
        const bossHit = bossesRef.current.get(data.targetId);
        if (bossHit) {
          bossHit.hitTime = performance.now();
          damageNumbersRef.current.push({ x: bossHit.displayX + TILE_SIZE / 2, y: bossHit.displayY, damage: data.damage, time: performance.now(), color: "#ff8800" });
          for (let i = 0; i < 8; i++) { particlesRef.current.push({ x: bossHit.displayX + TILE_SIZE / 2, y: bossHit.displayY, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 3, life: 25 + Math.random() * 15, maxLife: 40, color: Math.random() > 0.5 ? "#ff4400" : "#ffcc00", size: 3 }); }
        }
        // Player hit (by wolf or other mob)
        const player = playersRef.current.get(data.targetId);
        if (player) {
          damageNumbersRef.current.push({
            x: player.displayX + TILE_SIZE / 2,
            y: player.displayY,
            damage: data.damage,
            time: performance.now(),
          });
        }
        // Sound: hit on a monster = sfxHit, hit on local player = sfxPlayerHit
        if (data.targetId === sessionIdRef.current) {
          sfxPlayerHit();
          cameraShakeRef.current = { intensity: Math.min(data.damage * 0.15, 8), time: performance.now() };
        }
        else if (slime || wolf || goblin || skel) sfxHit();
      });

      room.onMessage("kill", (data: { killerName: string; xp: number; targetId?: string }) => {
        const tid = data.targetId || "";
        const monsterName = tid.startsWith("wolf_") ? "wolf" : tid.startsWith("goblin_") ? "goblin" : tid.startsWith("skeleton_") ? "skeleton" : "slime";
        killFeedRef.current.push({ text: `${data.killerName} slayed a ${monsterName}! (+${data.xp} XP)`, time: performance.now() });
        if (killFeedRef.current.length > 5) killFeedRef.current.shift();
        sfxKill();
      });

      room.onMessage("levelup", (data: { name: string; level: number; sessionId?: string }) => {
        killFeedRef.current.push({ text: `⭐ ${data.name} reached level ${data.level}!`, time: performance.now() });
        sfxLevelUp();
        // Spawn level-up particle effect
        const sid = data.sessionId || "";
        if (sid) {
          levelUpEffectsRef.current.push({ sessionId: sid, level: data.level, time: performance.now() });
          // Spawn golden particles
          const p = playersRef.current.get(sid);
          if (p) {
            const colors = ["#f1c40f", "#f39c12", "#e67e22", "#fff", "#ffd700"];
            for (let i = 0; i < 30; i++) {
              const angle = (Math.PI * 2 * i) / 30 + Math.random() * 0.3;
              const speed = 1.5 + Math.random() * 3;
              particlesRef.current.push({
                x: p.displayX + TILE_SIZE / 2,
                y: p.displayY + TILE_SIZE / 2 - 20,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1,
                life: 60 + Math.random() * 40,
                maxLife: 60 + Math.random() * 40,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: 2 + Math.random() * 3,
              });
            }
          }
        }
      });

      room.onMessage("pvp_hit", (data: { targetId: string; attackerName: string; damage: number }) => {
        const target = playersRef.current.get(data.targetId);
        if (target) {
          damageNumbersRef.current.push({
            x: target.displayX + TILE_SIZE / 2,
            y: target.displayY,
            damage: data.damage,
            time: performance.now(),
          });
        }
        if (data.targetId === sessionIdRef.current) {
          sfxPlayerHit();
          cameraShakeRef.current = { intensity: Math.min(data.damage * 0.2, 10), time: performance.now() };
        } else sfxHit();
      });

      room.onMessage("pvp_kill", (data: { killerName: string; targetName: string; xp: number }) => {
        killFeedRef.current.push({ text: `☠️ ${data.killerName} killed ${data.targetName}! (+${data.xp} XP)`, time: performance.now() });
        sfxKill();
      });

      room.onMessage("projectile", (data: { fromX: number; fromY: number; toX: number; toY: number }) => {
        projectilesRef.current.push({ ...data, time: performance.now() });
        sfxArrow();
      });

      room.onMessage("heal_effect", (data: { sessionId: string; amount: number }) => {
        const p = playersRef.current.get(data.sessionId);
        if (p) {
          damageNumbersRef.current.push({
            x: p.displayX + TILE_SIZE / 2,
            y: p.displayY,
            damage: data.amount,
            time: performance.now(),
            color: "#2ecc71",
            prefix: "+",
          });
        }
        // Healing particle effect — green sparkles rising upward
        if (p) {
          const colors = ["#2ecc71", "#27ae60", "#a8e6cf", "#81ecec"];
          for (let i = 0; i < 12; i++) {
            particlesRef.current.push({
              x: p.displayX + TILE_SIZE / 2 + (Math.random() - 0.5) * 30,
              y: p.displayY + TILE_SIZE / 2 + (Math.random() - 0.5) * 20,
              vx: (Math.random() - 0.5) * 1,
              vy: -1 - Math.random() * 2,
              life: 30 + Math.random() * 20,
              maxLife: 50,
              color: colors[Math.floor(Math.random() * colors.length)],
              size: 2 + Math.random() * 2,
            });
          }
        }
        if (data.sessionId === sessionIdRef.current) sfxHeal();
      });

      room.onMessage("mana_effect", (data: { sessionId: string; amount: number }) => {
        const p = playersRef.current.get(data.sessionId);
        if (p) {
          damageNumbersRef.current.push({
            x: p.displayX + TILE_SIZE / 2,
            y: p.displayY - 10,
            damage: data.amount,
            time: performance.now(),
            color: "#3498db",
            prefix: "+",
          });
        }
      });

      room.onMessage("cleave_effect", (data: { sessionId: string; x: number; y: number; hits: number }) => {
        const p = playersRef.current.get(data.sessionId);
        if (p) {
          damageNumbersRef.current.push({
            x: p.displayX + TILE_SIZE / 2,
            y: p.displayY - 20,
            damage: data.hits,
            time: performance.now(),
            color: "#f39c12",
            prefix: "⚔️ ",
          });
        }
        // Cleave arc particles
        if (p) {
          for (let i = 0; i < 16; i++) {
            const angle = (Math.PI * 2 * i) / 16;
            particlesRef.current.push({
              x: p.displayX + TILE_SIZE / 2,
              y: p.displayY + TILE_SIZE / 2,
              vx: Math.cos(angle) * 5,
              vy: Math.sin(angle) * 5,
              life: 15 + Math.random() * 10,
              maxLife: 25,
              color: i % 2 === 0 ? "#f39c12" : "#e74c3c",
              size: 3,
            });
          }
        }
        sfxCleave();
      });

      // ── New ability effect handlers ──
      room.onMessage("shield_wall_effect", (data: { sessionId: string; duration: number }) => {
        shieldWallEffectsRef.current.push({ sessionId: data.sessionId, time: performance.now(), duration: data.duration });
        // Set client-side cooldown
        abilityCooldownsRef.current.set("shield_wall", Date.now() + 20000);
        // Blue shield particles
        const p = playersRef.current.get(data.sessionId);
        if (p) {
          for (let i = 0; i < 12; i++) {
            const angle = (Math.PI * 2 * i) / 12;
            particlesRef.current.push({ x: p.displayX + TILE_SIZE / 2, y: p.displayY + TILE_SIZE / 2, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3, life: 30, maxLife: 30, color: "#3498db", size: 3 });
          }
          damageNumbersRef.current.push({ x: p.displayX + TILE_SIZE / 2, y: p.displayY - 20, damage: 0, time: performance.now(), color: "#3498db", prefix: "🛡️ Shield Wall!" });
        }
      });

      room.onMessage("war_cry_effect", (data: { sessionId: string; x: number; y: number; range: number; buffed: string[]; duration: number }) => {
        warCryEffectsRef.current.push({ x: data.x, y: data.y, time: performance.now(), range: data.range });
        abilityCooldownsRef.current.set("war_cry", Date.now() + 25000);
        const p = playersRef.current.get(data.sessionId);
        if (p) {
          // Orange/red war cry particles expanding outward
          for (let i = 0; i < 20; i++) {
            const angle = (Math.PI * 2 * i) / 20;
            particlesRef.current.push({ x: p.displayX + TILE_SIZE / 2, y: p.displayY + TILE_SIZE / 2, vx: Math.cos(angle) * 6, vy: Math.sin(angle) * 6, life: 25, maxLife: 25, color: i % 2 === 0 ? "#e74c3c" : "#f39c12", size: 4 });
          }
          damageNumbersRef.current.push({ x: p.displayX + TILE_SIZE / 2, y: p.displayY - 20, damage: 0, time: performance.now(), color: "#e74c3c", prefix: "⚔️ War Cry!" });
        }
      });

      room.onMessage("frost_applied", (data: { targetId: string; duration: number }) => {
        frostEffectsRef.current.push({ targetId: data.targetId, time: performance.now(), duration: data.duration });
        abilityCooldownsRef.current.set("frost_arrow", Date.now() + 12000);
        // Blue frost particles on target
        const getMonsterPos = (id: string) => {
          const s = slimesRef.current.get(id); if (s) return { x: s.displayX, y: s.displayY };
          const w = wolvesRef.current.get(id); if (w) return { x: w.displayX, y: w.displayY };
          const g = goblinsRef.current.get(id); if (g) return { x: g.displayX, y: g.displayY };
          const sk = skeletonsRef.current.get(id); if (sk) return { x: sk.displayX, y: sk.displayY };
          const b = bossesRef.current.get(id); if (b) return { x: b.displayX, y: b.displayY };
          return null;
        };
        const pos = getMonsterPos(data.targetId);
        if (pos) {
          for (let i = 0; i < 10; i++) {
            particlesRef.current.push({ x: pos.x + TILE_SIZE / 2, y: pos.y + TILE_SIZE / 2, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, life: 20, maxLife: 20, color: i % 3 === 0 ? "#ffffff" : "#74b9ff", size: 2.5 });
          }
        }
      });

      room.onMessage("rain_of_arrows_effect", (data: { sessionId: string; x: number; y: number; range: number; hits: number }) => {
        rainEffectsRef.current.push({ x: data.x, y: data.y, time: performance.now(), range: data.range, hits: data.hits });
        abilityCooldownsRef.current.set("rain_of_arrows", Date.now() + 18000);
        // Arrow rain particles falling from sky
        for (let i = 0; i < 25; i++) {
          const rx = data.x + (Math.random() - 0.5) * data.range * 2 * TILE_SIZE;
          const ry = data.y + (Math.random() - 0.5) * data.range * 2 * TILE_SIZE;
          particlesRef.current.push({ x: rx, y: ry - 100, vx: (Math.random() - 0.5) * 1, vy: 8 + Math.random() * 4, life: 20, maxLife: 20, color: "#8B4513", size: 2 });
        }
        const p = playersRef.current.get(data.sessionId);
        if (p) {
          damageNumbersRef.current.push({ x: data.x + TILE_SIZE / 2, y: data.y - 20, damage: data.hits, time: performance.now(), color: "#8B4513", prefix: "🏹 " });
        }
      });

      room.onMessage("cooldowns", (data: Record<string, number>) => {
        const now = Date.now();
        for (const [ability, remaining] of Object.entries(data)) {
          abilityCooldownsRef.current.set(ability, now + remaining);
        }
      });

      room.onMessage("status_applied", (data: { sessionId: string; effect: string }) => {
        const now = performance.now();
        const p = playersRef.current.get(data.sessionId);
        if (!p) return;
        const prefix = data.effect === "poison" ? "☠️ Poisoned!" : "🔥 Burning!";
        const color = data.effect === "poison" ? "#00ff00" : "#ff6600";
        damageNumbersRef.current.push({ x: p.displayX + TILE_SIZE / 2, y: p.displayY - 10, damage: 0, time: now, color, prefix });
        // Spawn status particles
        for (let i = 0; i < 8; i++) {
          particlesRef.current.push({ x: p.displayX + TILE_SIZE / 2, y: p.displayY + TILE_SIZE / 2, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2 - 1, life: 800, maxLife: 800, color, size: 3 });
        }
      });

      room.onMessage("status_tick", (data: { sessionId: string; effect: string; damage: number }) => {
        const now = performance.now();
        const p = playersRef.current.get(data.sessionId);
        if (!p) return;
        const color = data.effect === "poison" ? "#00ff00" : "#ff6600";
        const prefix = data.effect === "poison" ? "☠️" : "🔥";
        damageNumbersRef.current.push({ x: p.displayX + TILE_SIZE / 2 + (Math.random() - 0.5) * 20, y: p.displayY, damage: data.damage, time: now, color, prefix });
      });

      room.onMessage("loot_received", (data: { items: string[] }) => {
        const now = performance.now();
        for (const text of data.items) {
          lootNotifRef.current.push({ text, time: now });
        }
        if (lootNotifRef.current.length > 5) lootNotifRef.current.splice(0, lootNotifRef.current.length - 5);
        sfxLoot();
      });

      // ── Quest messages ──
      room.onMessage("npc_quests", (data: { npcId: string; npcName: string; available: any[]; turnIn: any[] }) => {
        if (data.available.length > 0 || data.turnIn.length > 0) {
          setQuestDialogData(data);
          setQuestDialogOpen(true);
        }
      });

      room.onMessage("quest_accepted", (data: { questId: string; questName: string; icon: string }) => {
        const now = performance.now();
        questNotifRef.current.push({ text: `📜 Quest accepted: ${data.icon} ${data.questName}`, time: now, color: "#ffd700" });
        if (questNotifRef.current.length > 5) questNotifRef.current.splice(0, questNotifRef.current.length - 5);
      });

      room.onMessage("quest_progress", (data: { questId: string; progress: number; required: number; completed: boolean; questName?: string }) => {
        const tracker = questTrackerRef.current;
        const existing = tracker.find(q => q.questId === data.questId);
        if (existing) {
          existing.progress = data.progress;
          existing.completed = data.completed;
        }
        if (!data.completed) {
          const now = performance.now();
          questNotifRef.current.push({ text: `⚔️ ${data.questName || data.questId}: ${data.progress}/${data.required}`, time: now, color: "#aaddff" });
          if (questNotifRef.current.length > 5) questNotifRef.current.splice(0, questNotifRef.current.length - 5);
        }
      });

      room.onMessage("quest_complete_ready", (data: { questId: string; questName: string; npcId: string }) => {
        const now = performance.now();
        questNotifRef.current.push({ text: `✅ Quest complete: ${data.questName} — Return to NPC!`, time: now, color: "#2ecc71" });
        if (questNotifRef.current.length > 5) questNotifRef.current.splice(0, questNotifRef.current.length - 5);
      });

      room.onMessage("quest_turned_in", (data: { questId: string; questName: string; rewards: string }) => {
        const now = performance.now();
        questNotifRef.current.push({ text: `🎉 ${data.questName} complete! Rewards: ${data.rewards}`, time: now, color: "#ffd700" });
        if (questNotifRef.current.length > 5) questNotifRef.current.splice(0, questNotifRef.current.length - 5);
        questTrackerRef.current = questTrackerRef.current.filter(q => q.questId !== data.questId);
        sfxLevelUp();
      });

      room.onMessage("quest_abandoned", (data: { questId: string }) => {
        questTrackerRef.current = questTrackerRef.current.filter(q => q.questId !== data.questId);
      });

      room.onMessage("quest_error", (data: { message: string }) => {
        const now = performance.now();
        questNotifRef.current.push({ text: `❌ ${data.message}`, time: now, color: "#e74c3c" });
      });

      // ── Fishing messages ──
      room.onMessage("fish_cast", (data: { duration: number }) => {
        fishingRef.current = { active: true, castTime: performance.now(), duration: data.duration, result: null, resultTime: 0 };
      });
      room.onMessage("fish_result", (data: { success: boolean; message: string; icon?: string }) => {
        fishingRef.current.active = false;
        fishingRef.current.result = data.message;
        fishingRef.current.resultTime = performance.now();
        if (data.success) sfxLoot();
      });
      room.onMessage("fish_cancel_notify", () => {
        fishingRef.current.active = false;
      });

      room.onMessage("npc_quest_markers", (data: Record<string, string>) => {
        const markers = npcQuestMarkersRef.current;
        markers.clear();
        for (const [npcId, markerType] of Object.entries(data)) {
          markers.set(npcId, markerType as "available" | "turnin");
        }
      });

      room.onMessage("quest_completed_announce", (data: { playerName: string; questName: string; questIcon: string }) => {
        killFeedRef.current.push({ text: `${data.playerName} completed ${data.questIcon} ${data.questName}!`, time: performance.now() });
        if (killFeedRef.current.length > 8) killFeedRef.current.shift();
      });

      // Players
      room.state.players.onAdd((player: any, sessionId: string) => {
        const data: PlayerData = {
          serverX: player.x, serverY: player.y,
          displayX: player.x, displayY: player.y,
          fromX: player.x, fromY: player.y,
          toX: player.x, toY: player.y,
          moveStartTime: 0,
          color: player.color, name: player.name,
          direction: player.direction || "down",
          moving: player.moving || false,
          hp: player.hp || 100, maxHp: player.maxHp || 100,
          mp: player.mp || 0, maxMp: player.maxMp || 50,
          xp: player.xp || 0, level: player.level || 1,
          playerClass: player.playerClass || "warrior",
          targetId: player.targetId || "",
          isHardcore: player.isHardcore || false,
          gold: player.gold || 0,
          inventory: [],
          deathTime: (player.hp || 100) <= 0 ? performance.now() : 0,
          equipWeapon: player.equipWeapon || "",
          equipHelmet: player.equipHelmet || "",
          equipChest: player.equipChest || "",
          equipLegs: player.equipLegs || "",
          equipBoots: player.equipBoots || "",
          defense: player.defense || 0,
          statusEffect: player.statusEffect || "",
          statusEffectEnd: player.statusEffectEnd || 0,
          killStreak: player.killStreak || 0,
          bestKillStreak: player.bestKillStreak || 0,
        };
        // Sync inventory
        if (player.inventory) {
          data.inventory = [];
          for (let i = 0; i < player.inventory.length; i++) {
            const slot = player.inventory[i];
            if (slot) data.inventory.push({ itemId: slot.itemId, quantity: slot.quantity });
          }
          player.inventory.onAdd((slot: any) => {
            const p = playersRef.current.get(sessionId);
            if (p) { p.inventory = []; for (let j = 0; j < player.inventory.length; j++) { const s = player.inventory[j]; if (s) p.inventory.push({ itemId: s.itemId, quantity: s.quantity }); } }
          });
          player.inventory.onRemove(() => {
            const p = playersRef.current.get(sessionId);
            if (p) { p.inventory = []; for (let j = 0; j < player.inventory.length; j++) { const s = player.inventory[j]; if (s) p.inventory.push({ itemId: s.itemId, quantity: s.quantity }); } }
          });
        }
        playersRef.current.set(sessionId, data);

        player.onChange(() => {
          const p = playersRef.current.get(sessionId);
          if (!p) return;
          const newX = player.x, newY = player.y;
          if (newX !== p.serverX || newY !== p.serverY) {
            p.fromX = p.displayX; p.fromY = p.displayY;
            p.toX = newX; p.toY = newY;
            p.moveStartTime = performance.now();
          }
          p.serverX = newX; p.serverY = newY;
          p.color = player.color; p.name = player.name;
          p.direction = player.direction || "down";
          p.moving = player.moving || false;
          p.hp = player.hp; p.maxHp = player.maxHp;
          p.mp = player.mp; p.maxMp = player.maxMp;
          p.xp = player.xp; p.level = player.level;
          p.playerClass = player.playerClass || "warrior";
          p.targetId = player.targetId || "";
          p.isHardcore = player.isHardcore || false;
          p.gold = player.gold || 0;
          p.equipWeapon = player.equipWeapon || "";
          p.equipHelmet = player.equipHelmet || "";
          p.equipChest = player.equipChest || "";
          p.equipLegs = player.equipLegs || "";
          p.equipBoots = player.equipBoots || "";
          p.defense = player.defense || 0;
          p.statusEffect = player.statusEffect || "";
          p.statusEffectEnd = player.statusEffectEnd || 0;
          p.killStreak = player.killStreak || 0;
          p.bestKillStreak = player.bestKillStreak || 0;
          // Track death moment
          if (player.hp <= 0 && p.deathTime === 0) {
            p.deathTime = performance.now();
            if (sid === sessionIdRef.current) sfxDeath();
          }
          if (player.hp > 0) p.deathTime = 0;
          // Re-sync inventory
          p.inventory = [];
          if (player.inventory) {
            for (let j = 0; j < player.inventory.length; j++) {
              const s = player.inventory[j];
              if (s) p.inventory.push({ itemId: s.itemId, quantity: s.quantity });
            }
          }
          // Re-sync quests for local player
          if (sid === sessionIdRef.current && player.quests) {
            const tracker: typeof questTrackerRef.current = [];
            for (let j = 0; j < player.quests.length; j++) {
              const q = player.quests[j];
              if (q && !q.turnedIn) {
                const QUEST_DEFS: Record<string, { name: string; icon: string; killTarget: string }> = {
                  slime_hunt: { name: "Slime Trouble", icon: "🟢", killTarget: "slime" },
                  wolf_menace: { name: "Wolf Menace", icon: "🐺", killTarget: "wolf" },
                  goblin_raid: { name: "Goblin Raiders", icon: "👹", killTarget: "goblin" },
                  skeleton_scourge: { name: "Undead Scourge", icon: "💀", killTarget: "skeleton" },
                  dragon_slayer: { name: "Dragon Slayer", icon: "🐉", killTarget: "boss" },
                  slime_bounty: { name: "Slime Bounty", icon: "💰", killTarget: "slime" },
                  wolf_bounty: { name: "Wolf Bounty", icon: "💰", killTarget: "wolf" },
                };
                const def = QUEST_DEFS[q.questId];
                tracker.push({
                  questId: q.questId,
                  name: def?.name || q.questId,
                  icon: def?.icon || "📜",
                  progress: q.progress,
                  required: q.required,
                  completed: q.completed,
                  killTarget: def?.killTarget || "",
                });
              }
            }
            questTrackerRef.current = tracker;
          }
        });
      });
      room.state.players.onRemove((_: any, sid: string) => { playersRef.current.delete(sid); });

      // Slimes
      room.state.slimes.onAdd((slime: any, id: string) => {
        const data: SlimeData = {
          displayX: slime.x, displayY: slime.y,
          fromX: slime.x, fromY: slime.y,
          toX: slime.x, toY: slime.y,
          moveStartTime: 0,
          serverX: slime.x, serverY: slime.y,
          hp: slime.hp, maxHp: slime.maxHp,
          color: slime.color, size: slime.size,
          alive: slime.alive,
          hitTime: 0,
        };
        slimesRef.current.set(id, data);

        slime.onChange(() => {
          const s = slimesRef.current.get(id);
          if (!s) return;
          const newX = slime.x, newY = slime.y;
          if (newX !== s.serverX || newY !== s.serverY) {
            s.fromX = s.displayX; s.fromY = s.displayY;
            s.toX = newX; s.toY = newY;
            s.moveStartTime = performance.now();
          }
          s.serverX = newX; s.serverY = newY;
          s.hp = slime.hp; s.maxHp = slime.maxHp;
          s.color = slime.color; s.alive = slime.alive;
        });
      });
      room.state.slimes.onRemove((_: any, id: string) => { slimesRef.current.delete(id); });

      // Wolves
      room.state.wolves.onAdd((wolf: any, id: string) => {
        const data: WolfData = {
          displayX: wolf.x, displayY: wolf.y,
          fromX: wolf.x, fromY: wolf.y,
          toX: wolf.x, toY: wolf.y,
          moveStartTime: 0,
          serverX: wolf.x, serverY: wolf.y,
          hp: wolf.hp, maxHp: wolf.maxHp,
          alive: wolf.alive,
          targetPlayerId: wolf.targetPlayerId || "",
          hitTime: 0,
        };
        wolvesRef.current.set(id, data);
        wolf.onChange(() => {
          const w = wolvesRef.current.get(id);
          if (!w) return;
          const newX = wolf.x, newY = wolf.y;
          if (newX !== w.serverX || newY !== w.serverY) {
            w.fromX = w.displayX; w.fromY = w.displayY;
            w.toX = newX; w.toY = newY;
            w.moveStartTime = performance.now();
          }
          w.serverX = newX; w.serverY = newY;
          w.hp = wolf.hp; w.maxHp = wolf.maxHp;
          w.alive = wolf.alive;
          w.targetPlayerId = wolf.targetPlayerId || "";
        });
      });
      room.state.wolves.onRemove((_: any, id: string) => { wolvesRef.current.delete(id); });

      // Goblins
      room.state.goblins.onAdd((goblin: any, id: string) => {
        const data: GoblinData = {
          displayX: goblin.x, displayY: goblin.y,
          fromX: goblin.x, fromY: goblin.y,
          toX: goblin.x, toY: goblin.y,
          moveStartTime: 0,
          serverX: goblin.x, serverY: goblin.y,
          hp: goblin.hp, maxHp: goblin.maxHp,
          alive: goblin.alive,
          variant: goblin.variant || "normal",
          targetPlayerId: goblin.targetPlayerId || "",
          hitTime: 0,
        };
        goblinsRef.current.set(id, data);
        goblin.onChange(() => {
          const g = goblinsRef.current.get(id);
          if (!g) return;
          const newX = goblin.x, newY = goblin.y;
          if (newX !== g.serverX || newY !== g.serverY) {
            g.fromX = g.displayX; g.fromY = g.displayY;
            g.toX = newX; g.toY = newY;
            g.moveStartTime = performance.now();
          }
          g.serverX = newX; g.serverY = newY;
          g.hp = goblin.hp; g.maxHp = goblin.maxHp;
          g.alive = goblin.alive;
          g.variant = goblin.variant || "normal";
          g.targetPlayerId = goblin.targetPlayerId || "";
        });
      });
      room.state.goblins.onRemove((_: any, id: string) => { goblinsRef.current.delete(id); });

      // Skeletons
      room.state.skeletons.onAdd((skeleton: any, id: string) => {
        const data: SkeletonData = {
          displayX: skeleton.x, displayY: skeleton.y,
          fromX: skeleton.x, fromY: skeleton.y,
          toX: skeleton.x, toY: skeleton.y,
          moveStartTime: 0,
          serverX: skeleton.x, serverY: skeleton.y,
          hp: skeleton.hp, maxHp: skeleton.maxHp,
          alive: skeleton.alive,
          targetPlayerId: skeleton.targetPlayerId || "",
          hitTime: 0,
        };
        skeletonsRef.current.set(id, data);
        skeleton.onChange(() => {
          const s = skeletonsRef.current.get(id);
          if (!s) return;
          const newX = skeleton.x, newY = skeleton.y;
          if (newX !== s.serverX || newY !== s.serverY) {
            s.fromX = s.displayX; s.fromY = s.displayY;
            s.toX = newX; s.toY = newY;
            s.moveStartTime = performance.now();
          }
          s.serverX = newX; s.serverY = newY;
          s.hp = skeleton.hp; s.maxHp = skeleton.maxHp;
          s.alive = skeleton.alive;
          s.targetPlayerId = skeleton.targetPlayerId || "";
        });
      });
      room.state.skeletons.onRemove((_: any, id: string) => { skeletonsRef.current.delete(id); });

      // Bosses
      room.state.bosses.onAdd((boss: any, id: string) => {
        const data: BossData = {
          displayX: boss.x, displayY: boss.y,
          fromX: boss.x, fromY: boss.y,
          toX: boss.x, toY: boss.y,
          moveStartTime: 0,
          serverX: boss.x, serverY: boss.y,
          hp: boss.hp, maxHp: boss.maxHp,
          alive: boss.alive,
          bossType: boss.bossType || "dragon",
          targetPlayerId: boss.targetPlayerId || "",
          phase: boss.phase || 1,
          hitTime: 0,
        };
        bossesRef.current.set(id, data);
        boss.onChange(() => {
          const b = bossesRef.current.get(id);
          if (!b) return;
          const newX = boss.x, newY = boss.y;
          if (newX !== b.serverX || newY !== b.serverY) {
            b.fromX = b.displayX; b.fromY = b.displayY;
            b.toX = newX; b.toY = newY;
            b.moveStartTime = performance.now();
          }
          b.serverX = newX; b.serverY = newY;
          b.hp = boss.hp; b.maxHp = boss.maxHp;
          b.alive = boss.alive;
          b.bossType = boss.bossType || "dragon";
          b.targetPlayerId = boss.targetPlayerId || "";
          b.phase = boss.phase || 1;
        });
      });
      room.state.bosses.onRemove((_: any, id: string) => { bossesRef.current.delete(id); });

      // Dropped items
      if (room.state.droppedItems) {
        room.state.droppedItems.onAdd((item: any, id: string) => {
          droppedItemsRef.current.set(id, {
            id, itemId: item.itemId, quantity: item.quantity,
            x: item.x, y: item.y, droppedAt: item.droppedAt,
          });
          item.onChange(() => {
            const d = droppedItemsRef.current.get(id);
            if (d) { d.x = item.x; d.y = item.y; d.quantity = item.quantity; }
          });
        });
        room.state.droppedItems.onRemove((_: any, id: string) => { droppedItemsRef.current.delete(id); });
      }

      // World events
      if (room.state.worldEvents) {
        room.state.worldEvents.onAdd((evt: any, id: string) => {
          worldEventsRef.current.set(id, {
            id, eventType: evt.eventType, x: evt.x, y: evt.y,
            spawnedAt: evt.spawnedAt, expiresAt: evt.expiresAt,
            active: evt.active, hp: evt.hp, maxHp: evt.maxHp,
          });
          evt.onChange(() => {
            const e = worldEventsRef.current.get(id);
            if (e) {
              e.x = evt.x; e.y = evt.y; e.active = evt.active;
              e.hp = evt.hp; e.maxHp = evt.maxHp;
              e.expiresAt = evt.expiresAt;
            }
          });
        });
        room.state.worldEvents.onRemove((_: any, id: string) => { worldEventsRef.current.delete(id); });
      }

      // World event messages
      room.onMessage("world_event_spawn", (data: { id: string; eventType: string; message: string; duration: number }) => {
        worldEventNotifsRef.current.push({ message: data.message, time: performance.now(), color: data.eventType === "golden_slime" ? "#ffd700" : data.eventType === "treasure_chest" ? "#f39c12" : data.eventType === "xp_orb" ? "#9b59b6" : "#3498db" });
      });
      room.onMessage("world_event_end", (data: { id: string; eventType: string; message: string }) => {
        worldEventNotifsRef.current.push({ message: data.message, time: performance.now(), color: "#e74c3c" });
      });
      room.onMessage("event_reward", (data: { eventType: string; message: string }) => {
        worldEventNotifsRef.current.push({ message: data.message, time: performance.now(), color: "#2ecc71" });
        sfxLoot();
      });

      // Boss event messages
      room.onMessage("boss_spawn", (data: { bossId: string; bossType: string }) => {
        killFeedRef.current.push({ text: `🐉 A ${data.bossType === "dragon" ? "Dragon" : "Boss"} has appeared!`, time: performance.now() });
      });
      room.onMessage("boss_enrage", (data: { bossId: string }) => {
        killFeedRef.current.push({ text: `🔥 The Dragon enters a rage! Its attacks grow fiercer!`, time: performance.now() });
      });
      room.onMessage("boss_killed", (data: { killerName: string; bossType: string; xp: number }) => {
        killFeedRef.current.push({ text: `🏆 ${data.killerName} has slain the ${data.bossType === "dragon" ? "Dragon" : "Boss"}! (+${data.xp} XP)`, time: performance.now() });
      });
      room.onMessage("boss_warning", (data: { message: string }) => {
        killFeedRef.current.push({ text: data.message, time: performance.now() });
      });

      // Kill streak announcements
      room.onMessage("kill_streak", (data: { sessionId: string; name: string; streak: number; title: string; xpBonus: number; goldBonus: number }) => {
        streakBannerRef.current = {
          title: data.title,
          name: data.name,
          streak: data.streak,
          time: performance.now(),
          xpBonus: data.xpBonus,
          goldBonus: data.goldBonus,
          isMine: data.sessionId === sessionIdRef.current,
        };
        killFeedRef.current.push({ text: `${data.title} ${data.name} — ${data.streak} kills! (+${data.xpBonus} XP, +${data.goldBonus} gold)`, time: performance.now() });
        if (killFeedRef.current.length > 8) killFeedRef.current.shift();
        // Camera shake on big streaks
        if (data.sessionId === sessionIdRef.current && data.streak >= 5) {
          cameraShakeRef.current = { intensity: Math.min(data.streak * 1.5, 15), time: performance.now() };
        }
      });
      room.onMessage("streak_ended", (data: { name: string; streak: number }) => {
        killFeedRef.current.push({ text: `💀 ${data.name}'s ${data.streak}-kill streak was ended!`, time: performance.now() });
        if (killFeedRef.current.length > 8) killFeedRef.current.shift();
      });
      room.onMessage("boss_aoe", (data: { bossId: string; x: number; y: number; range: number }) => {
        // Spawn lots of fire particles for the AOE
        for (let i = 0; i < 30; i++) {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.random() * data.range * TILE_SIZE;
          particlesRef.current.push({
            x: data.x + TILE_SIZE / 2 + Math.cos(angle) * r,
            y: data.y + TILE_SIZE / 2 + Math.sin(angle) * r,
            vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 3 - 1,
            life: 800, maxLife: 800,
            color: Math.random() > 0.5 ? "#ff4400" : "#ffcc00",
            size: 4 + Math.random() * 3,
          });
        }
      });

      room.onLeave(() => { if (!cancelled) setConnected(false); });
    }).catch((err) => { if (!cancelled) setError(err.message || "Failed to connect"); });

    return () => { cancelled = true; roomRef.current?.leave(); };
  }, [playerName, buildTileCache]);

  /* ── Input ──────────────────────────────────────────── */

  // Click-to-target handler
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    startAmbient(); // Start ambient on first click (requires user gesture)
    const canvas = canvasRef.current;
    if (!canvas) return;
    const me = playersRef.current.get(sessionIdRef.current);
    if (!me) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const w = canvas.width, h = canvas.height;
    const camX = me.displayX + TILE_SIZE / 2 - w / 2;
    const camY = me.displayY + TILE_SIZE / 2 - h / 2;

    const worldX = clickX + camX;
    const worldY = clickY + camY;

    // Check slimes
    let bestId = "";
    let bestDist = Infinity;

    slimesRef.current.forEach((s, id) => {
      if (!s.alive) return;
      const sx = s.displayX + TILE_SIZE / 2;
      const sy = s.displayY + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - sx) ** 2 + (worldY - sy) ** 2);
      if (d < TILE_SIZE && d < bestDist) { bestId = id; bestDist = d; }
    });

    // Check wolves
    wolvesRef.current.forEach((wolf, id) => {
      if (!wolf.alive) return;
      const wx = wolf.displayX + TILE_SIZE / 2;
      const wy = wolf.displayY + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - wx) ** 2 + (worldY - wy) ** 2);
      if (d < TILE_SIZE && d < bestDist) { bestId = id; bestDist = d; }
    });

    // Check goblins
    goblinsRef.current.forEach((g, id) => {
      if (!g.alive) return;
      const gx = g.displayX + TILE_SIZE / 2;
      const gy = g.displayY + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - gx) ** 2 + (worldY - gy) ** 2);
      if (d < TILE_SIZE && d < bestDist) { bestId = id; bestDist = d; }
    });

    // Check skeletons
    skeletonsRef.current.forEach((s, id) => {
      if (!s.alive) return;
      const sx = s.displayX + TILE_SIZE / 2;
      const sy = s.displayY + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - sx) ** 2 + (worldY - sy) ** 2);
      if (d < TILE_SIZE && d < bestDist) { bestId = id; bestDist = d; }
    });

    // Check bosses
    bossesRef.current.forEach((b, id) => {
      if (!b.alive) return;
      const bx = b.displayX + TILE_SIZE / 2;
      const by = b.displayY + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - bx) ** 2 + (worldY - by) ** 2);
      if (d < TILE_SIZE * 1.5 && d < bestDist) { bestId = id; bestDist = d; } // larger click area for boss
    });

    // Check players
    playersRef.current.forEach((p, sid) => {
      if (sid === sessionIdRef.current || p.hp <= 0) return;
      const px = p.displayX + TILE_SIZE / 2;
      const py = p.displayY + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - px) ** 2 + (worldY - py) ** 2);
      if (d < TILE_SIZE && d < bestDist) { bestId = sid; bestDist = d; }
    });

    // Check world events (click to interact or target)
    worldEventsRef.current.forEach((evt, id) => {
      if (!evt.active) return;
      const evx = evt.x + TILE_SIZE / 2;
      const evy = evt.y + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - evx) ** 2 + (worldY - evy) ** 2);
      if (d < TILE_SIZE * 1.2 && d < bestDist) {
        if (evt.eventType === "golden_slime" && evt.hp > 0) {
          // Target the golden slime for auto-attacks
          bestId = id;
          bestDist = d;
        } else if (evt.eventType === "treasure_chest" || evt.eventType === "xp_orb") {
          // Direct interaction
          roomRef.current?.send("interact_event", { eventId: id });
          return;
        }
        // Mana shrine doesn't need clicking — it's passive
      }
    });

    // Check dropped items (click to pick up)
    let closestDropId = "";
    let closestDropDist = Infinity;
    droppedItemsRef.current.forEach((drop, id) => {
      const ix = drop.x + TILE_SIZE / 2;
      const iy = drop.y + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - ix) ** 2 + (worldY - iy) ** 2);
      if (d < TILE_SIZE && d < closestDropDist) { closestDropId = id; closestDropDist = d; }
    });
    
    if (closestDropId && closestDropDist < bestDist) {
      roomRef.current?.send("pickup_item", { itemId: closestDropId });
      return;
    }

    if (bestId) {
      // If clicking the same target, toggle it off
      const currentTarget = me.targetId || "";
      if (currentTarget === bestId) {
        sendClearTarget();
      } else {
        sendSetTarget(bestId);
      }
    } else {
      sendClearTarget();
    }
  }, []);

  const talkToNearbyNPC = useCallback(() => {
    const me = playersRef.current.get(sessionIdRef.current);
    if (!me) return;
    const px = Math.round(me.toX / TILE_SIZE), py = Math.round(me.toY / TILE_SIZE);
    let closest: NPCData | null = null;
    let closestDist = Infinity;
    for (const npc of npcsRef.current) {
      const dist = Math.abs(px - npc.x) + Math.abs(py - npc.y);
      if (dist <= 2 && dist < closestDist) { closest = npc; closestDist = dist; }
    }
    if (closest) {
      // Always send npc_talk for quest checking; also open shop for merchant
      roomRef.current?.send("npc_talk", { npcId: closest.id });
      if (closest.id === "merchant") {
        setShopOpen(prev => !prev);
      }
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (chatOpen) {
          if (chatText.trim()) { roomRef.current?.send("chat", { message: chatText }); setChatText(""); }
          setChatOpen(false); canvasRef.current?.focus(); return;
        } else { e.preventDefault(); setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 50); return; }
      }
      if (e.key === "Escape" && inventoryOpen) { setInventoryOpen(false); canvasRef.current?.focus(); return; }
      if (e.key === "Escape" && shopOpen) { setShopOpen(false); canvasRef.current?.focus(); return; }
      if (e.key === "Escape" && questLogOpen) { setQuestLogOpen(false); canvasRef.current?.focus(); return; }
      if (e.key === "Escape" && questDialogOpen) { setQuestDialogOpen(false); canvasRef.current?.focus(); return; }
      if (e.key === "Escape" && chatOpen) { setChatOpen(false); setChatText(""); canvasRef.current?.focus(); return; }
      if (chatOpen) return;
      if (e.key === "Escape" && !chatOpen) { sendClearTarget(); return; }
      if (e.key === "i" || e.key === "I") { setInventoryOpen(prev => !prev); return; }
      if (e.key === "q" || e.key === "Q") { setQuestLogOpen(prev => !prev); return; }
      if (e.key === "f" || e.key === "F") { 
        if (fishingRef.current.active) {
          roomRef.current?.send("fish_cancel");
          fishingRef.current.active = false;
        } else {
          roomRef.current?.send("fish_start");
        }
        return;
      }
      if (e.key === "m" || e.key === "M") { setSoundMuted(toggleMute()); return; }
      if (e.key === "e" || e.key === "E") { talkToNearbyNPC(); return; }
      if (e.key === "1") { roomRef.current?.send("heal"); return; }
      if (e.key === "2") {
        const me = playersRef.current.get(sessionIdRef.current);
        if (me?.playerClass === "ranger") roomRef.current?.send("power_shot");
        else roomRef.current?.send("cleave");
        return;
      }
      if (e.key === "3") {
        // Slot 3: Frost Arrow (ranger) / Shield Wall (warrior)
        const me = playersRef.current.get(sessionIdRef.current);
        if (me?.playerClass === "ranger") roomRef.current?.send("frost_arrow");
        else roomRef.current?.send("shield_wall");
        return;
      }
      if (e.key === "4") {
        // Slot 4: Rain of Arrows (ranger) / War Cry (warrior)
        const me = playersRef.current.get(sessionIdRef.current);
        if (me?.playerClass === "ranger") roomRef.current?.send("rain_of_arrows");
        else roomRef.current?.send("war_cry");
        return;
      }
      if (e.key === "5") {
        // Slot 5: Health Potion
        const now = Date.now();
        if (now - lastPotionUse.current >= POTION_COOLDOWN_MS) {
          roomRef.current?.send("use_potion", { itemId: "health_potion" });
          lastPotionUse.current = now;
        }
        return;
      }
      if (e.key === "6") {
        // Slot 6: Mana Potion
        const now = Date.now();
        if (now - lastPotionUse.current >= POTION_COOLDOWN_MS) {
          roomRef.current?.send("use_potion", { itemId: "mana_potion" });
          lastPotionUse.current = now;
        }
        return;
      }
      if (["w","a","s","d","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
        e.preventDefault(); keysRef.current.add(e.key);
      }
    };
    const up = (e: KeyboardEvent) => { keysRef.current.delete(e.key); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [chatOpen, chatText, talkToNearbyNPC, shopOpen, inventoryOpen, questLogOpen, questDialogOpen]);

  const handleDpad = (dx: number, dy: number, pressed: boolean) => {
    if (pressed) dpadRef.current = { dx, dy };
    else if (dpadRef.current.dx === dx && dpadRef.current.dy === dy) dpadRef.current = { dx: 0, dy: 0 };
  };

  /* ── Draw helpers ───────────────────────────────────── */

  const drawBubble = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, alpha: number) => {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.font = "12px 'Segoe UI', sans-serif";
    const tw = Math.min(ctx.measureText(text).width, maxW);
    const bw = tw + 16, bh = 24, bx = x - bw / 2, by = y - bh;
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 5, by + bh); ctx.lineTo(x, by + bh + 6); ctx.lineTo(x + 5, by + bh); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(text, x, by + 16, maxW);
    ctx.restore();
  };

  const drawHPBar = (ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, maxHp: number, w: number) => {
    const h = 5;
    const bx = x - w / 2, by = y;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = "#333"; ctx.fillRect(bx, by, w, h);
    const pct = Math.max(0, hp / maxHp);
    const color = pct > 0.5 ? "#2ecc71" : pct > 0.25 ? "#f39c12" : "#e74c3c";
    ctx.fillStyle = color; ctx.fillRect(bx, by, w * pct, h);
  };

  /* ── Game loop ──────────────────────────────────────── */

  useEffect(() => {
    if (!connected) return;
    let animId: number;

    const loop = (time: number) => {
      const now = performance.now();

      // Input
      if (now - lastMoveTimeRef.current >= KEY_REPEAT_MS) {
        const keys = keysRef.current;
        let dx = 0, dy = 0;
        if (keys.has("w") || keys.has("ArrowUp")) dy = -1;
        else if (keys.has("s") || keys.has("ArrowDown")) dy = 1;
        else if (keys.has("a") || keys.has("ArrowLeft")) dx = -1;
        else if (keys.has("d") || keys.has("ArrowRight")) dx = 1;
        if (dx === 0 && dy === 0) { dx = dpadRef.current.dx; dy = dpadRef.current.dy; }
        if (dx !== 0 || dy !== 0) { sendMove(dx, dy); lastMoveTimeRef.current = now; }
      }

      // Update player positions
      playersRef.current.forEach((p) => {
        p.displayX = getDisplayPos(p.fromX, p.toX, p.moveStartTime, now);
        p.displayY = getDisplayPos(p.fromY, p.toY, p.moveStartTime, now);
        if (p.moveStartTime > 0 && now - p.moveStartTime >= MOVE_DURATION) {
          p.displayX = p.toX; p.displayY = p.toY; p.fromX = p.toX; p.fromY = p.toY; p.moveStartTime = 0;
        }
      });

      // Update slime positions
      slimesRef.current.forEach((s) => {
        s.displayX = getDisplayPos(s.fromX, s.toX, s.moveStartTime, now);
        s.displayY = getDisplayPos(s.fromY, s.toY, s.moveStartTime, now);
        if (s.moveStartTime > 0 && now - s.moveStartTime >= MOVE_DURATION * 3) {
          s.displayX = s.toX; s.displayY = s.toY; s.fromX = s.toX; s.fromY = s.toY; s.moveStartTime = 0;
        }
      });

      // Update wolf positions (smooth interpolation)
      const WOLF_MOVE_DURATION = 300; // ms to lerp between tiles
      wolvesRef.current.forEach((w) => {
        if (w.moveStartTime > 0) {
          const t = Math.min((now - w.moveStartTime) / WOLF_MOVE_DURATION, 1);
          w.displayX = w.fromX + (w.toX - w.fromX) * t;
          w.displayY = w.fromY + (w.toY - w.fromY) * t;
          if (t >= 1) {
            w.displayX = w.toX; w.displayY = w.toY;
            w.fromX = w.toX; w.fromY = w.toY;
            w.moveStartTime = 0;
          }
        }
      });

      // Update goblin positions
      const GOBLIN_MOVE_DURATION = 250;
      goblinsRef.current.forEach((g) => {
        if (g.moveStartTime > 0) {
          const t = Math.min((now - g.moveStartTime) / GOBLIN_MOVE_DURATION, 1);
          g.displayX = g.fromX + (g.toX - g.fromX) * t;
          g.displayY = g.fromY + (g.toY - g.fromY) * t;
          if (t >= 1) { g.displayX = g.toX; g.displayY = g.toY; g.fromX = g.toX; g.fromY = g.toY; g.moveStartTime = 0; }
        }
      });

      // Update skeleton positions
      const SKELETON_MOVE_DURATION = 400;
      skeletonsRef.current.forEach((s) => {
        if (s.moveStartTime > 0) {
          const t = Math.min((now - s.moveStartTime) / SKELETON_MOVE_DURATION, 1);
          s.displayX = s.fromX + (s.toX - s.fromX) * t;
          s.displayY = s.fromY + (s.toY - s.fromY) * t;
          if (t >= 1) { s.displayX = s.toX; s.displayY = s.toY; s.fromX = s.toX; s.fromY = s.toY; s.moveStartTime = 0; }
        }
      });

      // Update boss positions
      const BOSS_MOVE_DURATION = 500;
      bossesRef.current.forEach((b) => {
        if (b.moveStartTime > 0) {
          const t = Math.min((now - b.moveStartTime) / BOSS_MOVE_DURATION, 1);
          b.displayX = b.fromX + (b.toX - b.fromX) * t;
          b.displayY = b.fromY + (b.toY - b.fromY) * t;
          if (t >= 1) { b.displayX = b.toX; b.displayY = b.toY; b.fromX = b.toX; b.fromY = b.toY; b.moveStartTime = 0; }
        }
      });

      // Clean up timed effects
      chatBubblesRef.current = chatBubblesRef.current.filter(b => now - b.time < CHAT_DURATION);
      emoteBubblesRef.current = emoteBubblesRef.current.filter(b => now - b.time < EMOTE_DURATION);
      damageNumbersRef.current = damageNumbersRef.current.filter(d => now - d.time < DAMAGE_DURATION);
      killFeedRef.current = killFeedRef.current.filter(k => now - k.time < 5000);
      projectilesRef.current = projectilesRef.current.filter(p => now - p.time < 400);
      lootNotifRef.current = lootNotifRef.current.filter(l => now - l.time < 3000);
      worldEventNotifsRef.current = worldEventNotifsRef.current.filter(n => now - n.time < 5000);
      levelUpEffectsRef.current = levelUpEffectsRef.current.filter(e => now - e.time < 2000);
      // Update particles
      particlesRef.current = particlesRef.current.filter(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life--; return p.life > 0; });
      if (npcDialogueRef.current && now - npcDialogueRef.current.time > NPC_DIALOGUE_DURATION) npcDialogueRef.current = null;

      // Canvas
      const canvas = canvasRef.current;
      if (!canvas) { animId = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { animId = requestAnimationFrame(loop); return; }

      const w = window.innerWidth, h = window.innerHeight;
      if (canvasSizeRef.current.w !== w || canvasSizeRef.current.h !== h) {
        canvas.width = w; canvas.height = h; canvasSizeRef.current = { w, h };
      } else { ctx.clearRect(0, 0, w, h); }

      const WORLD_W = mapSizeRef.current.w * TILE_SIZE;
      const WORLD_H = mapSizeRef.current.h * TILE_SIZE;
      const me = playersRef.current.get(sessionIdRef.current);
      
      // Auto-pickup dropped items when walking over them (throttled to every 200ms)
      if (me && me.hp > 0 && now - (lastAutoPickupRef.current || 0) > 200) {
        const px = me.displayX + TILE_SIZE / 2;
        const py = me.displayY + TILE_SIZE / 2;
        droppedItemsRef.current.forEach((drop, id) => {
          const ix = drop.x + TILE_SIZE / 2;
          const iy = drop.y + TILE_SIZE / 2;
          const d = Math.sqrt((px - ix) ** 2 + (py - iy) ** 2);
          if (d < TILE_SIZE * 0.8) {
            roomRef.current?.send("pickup_item", { itemId: id });
          }
        });
        // Also auto-interact with world events when walking over them
        worldEventsRef.current.forEach((evt, id) => {
          if (!evt.active) return;
          if (evt.eventType !== "treasure_chest" && evt.eventType !== "xp_orb") return;
          const ex = evt.x + TILE_SIZE / 2;
          const ey = evt.y + TILE_SIZE / 2;
          const d = Math.sqrt((px - ex) ** 2 + (py - ey) ** 2);
          if (d < TILE_SIZE * 0.8) {
            roomRef.current?.send("interact_event", { eventId: id });
          }
        });

        lastAutoPickupRef.current = now;
      }

      // Camera shake
      let shakeX = 0, shakeY = 0;
      const shakeAge = now - cameraShakeRef.current.time;
      if (shakeAge < 300 && cameraShakeRef.current.intensity > 0) {
        const decay = 1 - shakeAge / 300;
        const intensity = cameraShakeRef.current.intensity * decay;
        shakeX = (Math.random() - 0.5) * intensity * 2;
        shakeY = (Math.random() - 0.5) * intensity * 2;
      }
      const camX = (me ? me.displayX + TILE_SIZE / 2 - w / 2 : 0) + shakeX;
      const camY = (me ? me.displayY + TILE_SIZE / 2 - h / 2 : 0) + shakeY;

      // Tilemap
      if (tileCacheRef.current) {
        ctx.drawImage(tileCacheRef.current, -camX, -camY);
      } else {
        ctx.fillStyle = "#2d5a1e"; ctx.fillRect(0, 0, w, h);
      }

      // Out-of-bounds
      ctx.fillStyle = "#0a1a05";
      if (camX < 0) ctx.fillRect(0, 0, -camX, h);
      if (WORLD_W - camX < w) ctx.fillRect(WORLD_W - camX, 0, w - (WORLD_W - camX), h);
      if (camY < 0) ctx.fillRect(0, 0, w, -camY);
      if (WORLD_H - camY < h) ctx.fillRect(0, WORLD_H - camY, w, h - (WORLD_H - camY));

      // Grid
      ctx.strokeStyle = "rgba(0,0,0,0.04)"; ctx.lineWidth = 1;
      for (let x = -(camX % TILE_SIZE); x < w; x += TILE_SIZE) { const wx = x + camX; if (wx >= 0 && wx <= WORLD_W) { ctx.beginPath(); ctx.moveTo(x, Math.max(0, -camY)); ctx.lineTo(x, Math.min(h, WORLD_H - camY)); ctx.stroke(); } }
      for (let y = -(camY % TILE_SIZE); y < h; y += TILE_SIZE) { const wy = y + camY; if (wy >= 0 && wy <= WORLD_H) { ctx.beginPath(); ctx.moveTo(Math.max(0, -camX), y); ctx.lineTo(Math.min(w, WORLD_W - camX), y); ctx.stroke(); } }

      /* ── Slimes ──────────────────────────────────────── */

      const myTargetId = me?.targetId || "";

      slimesRef.current.forEach((s, slimeId) => {
        if (!s.alive) return;
        const sx = s.displayX + TILE_SIZE / 2 - camX;
        const sy = s.displayY + TILE_SIZE / 2 - camY;
        if (sx < -80 || sx > w + 80 || sy < -80 || sy > h + 80) return;

        const isTargeted = myTargetId === slimeId;
        const sizeScale = s.size === "small" ? 0.7 : s.size === "big" ? 1.3 : 1.0;
        const baseR = 16 * sizeScale;
        const isHit = s.hitTime > 0 && now - s.hitTime < 200;

        // Bounce animation
        const bounce = Math.abs(Math.sin(time / 400)) * 4 * sizeScale;

        // Target highlight (red pulsing square)
        if (isTargeted) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(sx - TILE_SIZE / 2, sy - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        }

        // Shadow
        ctx.beginPath();
        ctx.ellipse(sx, sy + 18, baseR, baseR * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fill();

        // Body
        ctx.save();
        if (isHit) { ctx.globalAlpha = 0.5 + Math.sin(now * 0.05) * 0.5; }

        // Slime body (blobby shape)
        ctx.beginPath();
        ctx.ellipse(sx, sy + 6 - bounce, baseR, baseR * 0.8 + bounce * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();

        // Highlight
        ctx.beginPath();
        ctx.ellipse(sx - baseR * 0.3, sy - baseR * 0.2 - bounce, baseR * 0.35, baseR * 0.25, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fill();

        // Eyes
        const eyeY = sy + 2 - bounce;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(sx - 5 * sizeScale, eyeY, 4 * sizeScale, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + 5 * sizeScale, eyeY, 4 * sizeScale, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#333";
        ctx.beginPath(); ctx.arc(sx - 4 * sizeScale, eyeY + 1, 2 * sizeScale, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + 6 * sizeScale, eyeY + 1, 2 * sizeScale, 0, Math.PI * 2); ctx.fill();

        ctx.restore();

        // HP bar (only if damaged or targeted) — consistent 40px width
        if (s.hp < s.maxHp || isTargeted) {
          drawHPBar(ctx, sx, sy - baseR - 8 - bounce, s.hp, s.maxHp, 40);
        }
      });

      /* ── Wolves ─────────────────────────────────────── */

      wolvesRef.current.forEach((wolf, wolfId) => {
        if (!wolf.alive) return;
        const wx = wolf.displayX + TILE_SIZE / 2 - camX;
        const wy = wolf.displayY + TILE_SIZE / 2 - camY;
        if (wx < -80 || wx > w + 80 || wy < -80 || wy > h + 80) return;

        const isWolfTargeted = myTargetId === wolfId;

        // Target highlight
        if (isWolfTargeted) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(wx - TILE_SIZE / 2, wy - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        }

        // Shadow
        ctx.beginPath(); ctx.ellipse(wx, wy + 16, 16, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();

        // Wolf body — a dark gray canine shape
        ctx.save();
        // Flash red on hit
        const wolfHitFlash = wolf.hitTime && (now - wolf.hitTime < 200);
        if (wolfHitFlash) ctx.globalAlpha = 0.6 + Math.sin(now / 30) * 0.4;

        // Body (elongated oval)
        ctx.fillStyle = "#4a4a4a";
        ctx.beginPath();
        ctx.ellipse(wx, wy - 2, 20, 14, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.beginPath();
        ctx.ellipse(wx + 14, wy - 10, 10, 9, -0.3, 0, Math.PI * 2);
        ctx.fill();

        // Ears
        ctx.fillStyle = "#3a3a3a";
        ctx.beginPath(); ctx.moveTo(wx + 16, wy - 18); ctx.lineTo(wx + 12, wy - 26); ctx.lineTo(wx + 22, wy - 18); ctx.fill();
        ctx.beginPath(); ctx.moveTo(wx + 20, wy - 18); ctx.lineTo(wx + 18, wy - 26); ctx.lineTo(wx + 26, wy - 18); ctx.fill();

        // Eyes (red glow)
        ctx.fillStyle = wolfHitFlash ? "#fff" : "#ff3333";
        ctx.beginPath(); ctx.arc(wx + 18, wy - 12, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(wx + 12, wy - 12, 2, 0, Math.PI * 2); ctx.fill();

        // Tail
        ctx.strokeStyle = "#4a4a4a"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(wx - 18, wy - 2);
        ctx.quadraticCurveTo(wx - 26, wy - 16, wx - 22, wy - 20);
        ctx.stroke();

        // Legs
        ctx.strokeStyle = "#3a3a3a"; ctx.lineWidth = 3;
        const legBounce = Math.sin(time / 150) * 3;
        ctx.beginPath(); ctx.moveTo(wx - 10, wy + 10); ctx.lineTo(wx - 12, wy + 18 + legBounce); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(wx - 4, wy + 10); ctx.lineTo(wx - 2, wy + 18 - legBounce); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(wx + 6, wy + 10); ctx.lineTo(wx + 4, wy + 18 + legBounce); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(wx + 12, wy + 10); ctx.lineTo(wx + 14, wy + 18 - legBounce); ctx.stroke();

        ctx.restore();

        // Name above HP bar
        ctx.font = "bold 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText("Wolf", wx + 1, wy - 37);
        ctx.fillStyle = "#ff6b6b"; ctx.fillText("Wolf", wx, wy - 38);

        // HP bar
        if (wolf.hp < wolf.maxHp || isWolfTargeted) {
          drawHPBar(ctx, wx, wy - 30, wolf.hp, wolf.maxHp, 40);
        }
      });

      /* ── Goblins ───────────────────────────────────────── */
      goblinsRef.current.forEach((g, goblinId) => {
        if (!g.alive) return;
        const gx = g.displayX + TILE_SIZE / 2 - camX;
        const gy = g.displayY + TILE_SIZE / 2 - camY;
        if (gx < -80 || gx > w + 80 || gy < -80 || gy > h + 80) return;

        const isGoblinTargeted = myTargetId === goblinId;

        if (isGoblinTargeted) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(gx - TILE_SIZE / 2, gy - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        }

        ctx.save();
        const gobHit = g.hitTime && (now - g.hitTime < 200);
        if (gobHit) ctx.globalAlpha = 0.6 + Math.sin(now / 30) * 0.4;

        // Shadow
        ctx.beginPath(); ctx.ellipse(gx, gy + 14, 12, 4, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();

        // Goblin body — green hunched creature
        const hop = Math.sin(time / 200) * 2;
        ctx.fillStyle = "#4a8c3f";
        ctx.beginPath();
        ctx.ellipse(gx, gy + 2 - hop, 14, 16, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.fillStyle = "#5da84e";
        ctx.beginPath();
        ctx.arc(gx, gy - 14 - hop, 10, 0, Math.PI * 2);
        ctx.fill();

        // Pointy ears
        ctx.fillStyle = "#4a8c3f";
        ctx.beginPath(); ctx.moveTo(gx - 10, gy - 16 - hop); ctx.lineTo(gx - 18, gy - 24 - hop); ctx.lineTo(gx - 6, gy - 12 - hop); ctx.fill();
        ctx.beginPath(); ctx.moveTo(gx + 10, gy - 16 - hop); ctx.lineTo(gx + 18, gy - 24 - hop); ctx.lineTo(gx + 6, gy - 12 - hop); ctx.fill();

        // Eyes (yellow, beady)
        ctx.fillStyle = "#ff0";
        ctx.beginPath(); ctx.arc(gx - 4, gy - 16 - hop, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx + 4, gy - 16 - hop, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.arc(gx - 3, gy - 15 - hop, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx + 5, gy - 15 - hop, 1.5, 0, Math.PI * 2); ctx.fill();

        // Variant indicator
        if (g.variant === "archer") {
          // Small bow
          ctx.strokeStyle = "#8B4513"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(gx + 16, gy - 5 - hop, 10, -0.8, 0.8); ctx.stroke();
        } else if (g.variant === "shaman") {
          // Staff glow
          ctx.fillStyle = "#9b59b6";
          ctx.beginPath(); ctx.arc(gx - 14, gy - 20 - hop, 4, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#6c3483"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(gx - 14, gy - 16 - hop); ctx.lineTo(gx - 14, gy + 10 - hop); ctx.stroke();
        }

        ctx.restore();

        // Name
        ctx.font = "bold 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText("Goblin", gx + 1, gy - 33 - (g.hitTime ? 0 : 0));
        ctx.fillStyle = "#7dcea0"; ctx.fillText(g.variant === "shaman" ? "Goblin Shaman" : g.variant === "archer" ? "Goblin Archer" : "Goblin", gx, gy - 34);

        if (g.hp < g.maxHp || isGoblinTargeted) {
          drawHPBar(ctx, gx, gy - 28, g.hp, g.maxHp, 40);
        }
      });

      /* ── Skeletons ──────────────────────────────────── */
      skeletonsRef.current.forEach((sk, skelId) => {
        if (!sk.alive) return;
        const sx = sk.displayX + TILE_SIZE / 2 - camX;
        const sy = sk.displayY + TILE_SIZE / 2 - camY;
        if (sx < -80 || sx > w + 80 || sy < -80 || sy > h + 80) return;

        const isSkelTargeted = myTargetId === skelId;

        if (isSkelTargeted) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(sx - TILE_SIZE / 2, sy - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        }

        ctx.save();
        const skelHit = sk.hitTime && (now - sk.hitTime < 200);
        if (skelHit) ctx.globalAlpha = 0.6 + Math.sin(now / 30) * 0.4;

        // Shadow
        ctx.beginPath(); ctx.ellipse(sx, sy + 16, 10, 4, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();

        // Skeleton body — bony white figure
        // Spine
        ctx.strokeStyle = "#e8e8e8"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10); ctx.stroke();
        // Ribs
        ctx.lineWidth = 2;
        for (let r = 0; r < 3; r++) {
          const ry = sy - 4 + r * 6;
          ctx.beginPath(); ctx.moveTo(sx - 8, ry); ctx.lineTo(sx + 8, ry); ctx.stroke();
        }
        // Skull
        ctx.fillStyle = "#f0f0f0";
        ctx.beginPath(); ctx.arc(sx, sy - 16, 10, 0, Math.PI * 2); ctx.fill();
        // Eye sockets (dark)
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath(); ctx.arc(sx - 4, sy - 18, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + 4, sy - 18, 3, 0, Math.PI * 2); ctx.fill();
        // Jaw
        ctx.strokeStyle = "#d0d0d0"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx - 5, sy - 10); ctx.lineTo(sx - 3, sy - 7); ctx.lineTo(sx + 3, sy - 7); ctx.lineTo(sx + 5, sy - 10); ctx.stroke();
        // Arms
        ctx.strokeStyle = "#e0e0e0"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx - 8, sy - 4); ctx.lineTo(sx - 16, sy + 4 + Math.sin(time / 250) * 3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx + 8, sy - 4); ctx.lineTo(sx + 16, sy + 4 - Math.sin(time / 250) * 3); ctx.stroke();
        // Legs
        ctx.beginPath(); ctx.moveTo(sx, sy + 10); ctx.lineTo(sx - 6, sy + 22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx, sy + 10); ctx.lineTo(sx + 6, sy + 22); ctx.stroke();

        // Red eye glow
        ctx.fillStyle = skelHit ? "#fff" : "rgba(255,50,50,0.6)";
        ctx.beginPath(); ctx.arc(sx - 4, sy - 18, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + 4, sy - 18, 1.5, 0, Math.PI * 2); ctx.fill();

        ctx.restore();

        // Name
        ctx.font = "bold 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText("Skeleton", sx + 1, sy - 33);
        ctx.fillStyle = "#bdc3c7"; ctx.fillText("Skeleton", sx, sy - 34);

        if (sk.hp < sk.maxHp || isSkelTargeted) {
          drawHPBar(ctx, sx, sy - 28, sk.hp, sk.maxHp, 40);
        }
      });

      /* ── Bosses ─────────────────────────────────────── */
      bossesRef.current.forEach((b, bossId) => {
        if (!b.alive) return;
        const bx = b.displayX + TILE_SIZE / 2 - camX;
        const by = b.displayY + TILE_SIZE / 2 - camY;
        if (bx < -120 || bx > w + 120 || by < -120 || by > h + 120) return;

        const isBossTargeted = myTargetId === bossId;
        if (isBossTargeted) {
          const pulse = 0.5 + Math.sin(time / 150) * 0.4;
          ctx.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(bx - TILE_SIZE / 2 - 8, by - TILE_SIZE / 2 - 8, TILE_SIZE + 16, TILE_SIZE + 16);
        }

        const bossHit = b.hitTime && (now - b.hitTime < 200);
        const isEnraged = b.phase >= 2;

        ctx.save();
        if (bossHit) ctx.globalAlpha = 0.6 + Math.sin(now / 30) * 0.4;

        // Shadow (bigger)
        ctx.beginPath(); ctx.ellipse(bx, by + 22, 24, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fill();

        // Dragon body — large red/orange beast
        const bodyColor = isEnraged ? "#cc0000" : "#8B0000";
        const wingColor = isEnraged ? "#ff2200" : "#B22222";
        const eyeColor = isEnraged ? "#ffff00" : "#ff4444";

        // Body
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.ellipse(bx, by, 22, 16, 0, 0, Math.PI * 2); ctx.fill();

        // Head
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(bx, by - 22, 12, 0, Math.PI * 2); ctx.fill();

        // Snout
        ctx.fillStyle = isEnraged ? "#990000" : "#6B0000";
        ctx.beginPath(); ctx.ellipse(bx, by - 30, 6, 4, 0, 0, Math.PI * 2); ctx.fill();

        // Eyes (glowing)
        ctx.fillStyle = eyeColor;
        ctx.beginPath(); ctx.arc(bx - 5, by - 24, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + 5, by - 24, 3, 0, Math.PI * 2); ctx.fill();
        // Eye glow
        ctx.fillStyle = `rgba(255, ${isEnraged ? 255 : 100}, 0, ${0.3 + Math.sin(time / 200) * 0.2})`;
        ctx.beginPath(); ctx.arc(bx - 5, by - 24, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + 5, by - 24, 5, 0, Math.PI * 2); ctx.fill();

        // Horns
        ctx.strokeStyle = "#444"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(bx - 8, by - 28); ctx.lineTo(bx - 14, by - 38); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx + 8, by - 28); ctx.lineTo(bx + 14, by - 38); ctx.stroke();

        // Wings (flapping animation)
        const wingFlap = Math.sin(time / 300) * 0.3;
        ctx.fillStyle = wingColor;
        // Left wing
        ctx.save(); ctx.translate(bx - 18, by - 8); ctx.rotate(-0.5 + wingFlap);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-24, -18); ctx.lineTo(-18, 0); ctx.lineTo(-28, 8); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        // Right wing
        ctx.save(); ctx.translate(bx + 18, by - 8); ctx.rotate(0.5 - wingFlap);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(24, -18); ctx.lineTo(18, 0); ctx.lineTo(28, 8); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
        ctx.restore();

        // Tail
        ctx.strokeStyle = bodyColor; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(bx, by + 12);
        ctx.quadraticCurveTo(bx + 20, by + 22, bx + 30, by + 14 + Math.sin(time / 400) * 4);
        ctx.stroke();
        // Tail spike
        ctx.fillStyle = "#444";
        ctx.beginPath(); ctx.moveTo(bx + 30, by + 14 + Math.sin(time / 400) * 4);
        ctx.lineTo(bx + 36, by + 10); ctx.lineTo(bx + 34, by + 18); ctx.closePath(); ctx.fill();

        // Fire breath particles when enraged
        if (isEnraged && Math.random() < 0.3) {
          particlesRef.current.push({
            x: b.displayX + TILE_SIZE / 2 + (Math.random() - 0.5) * 10,
            y: b.displayY + TILE_SIZE / 2 - 30,
            vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2 - 1,
            life: 400, maxLife: 400,
            color: Math.random() > 0.4 ? "#ff4400" : "#ffcc00",
            size: 2 + Math.random() * 3,
          });
        }

        ctx.restore();

        // Boss name (red, larger)
        const bossName = isEnraged ? "🔥 Dragon (Enraged)" : "🐉 Dragon";
        ctx.font = "bold 13px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(bossName, bx + 1, by - 43);
        ctx.fillStyle = isEnraged ? "#ff4444" : "#ff8800"; ctx.fillText(bossName, bx, by - 44);

        // Boss HP bar (wider)
        const bossHpW = 60;
        const bossHpH = 6;
        const bossHpX = bx - bossHpW / 2;
        const bossHpY = by - 38;
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bossHpX - 1, bossHpY - 1, bossHpW + 2, bossHpH + 2);
        ctx.fillStyle = "#1a1a1a"; ctx.fillRect(bossHpX, bossHpY, bossHpW, bossHpH);
        const hpRatio = b.maxHp > 0 ? b.hp / b.maxHp : 0;
        const hpCol = hpRatio > 0.4 ? "#e74c3c" : "#ff0000";
        ctx.fillStyle = hpCol; ctx.fillRect(bossHpX, bossHpY, bossHpW * hpRatio, bossHpH);
        // HP text
        ctx.font = "bold 9px 'Segoe UI', sans-serif";
        ctx.fillStyle = "#fff"; ctx.fillText(`${b.hp}/${b.maxHp}`, bx, bossHpY + bossHpH - 1);
      });

      /* ── Ground Items (dropped loot) ────────────────── */
      droppedItemsRef.current.forEach((drop) => {
        const dx = drop.x + TILE_SIZE / 2 - camX;
        const dy = drop.y + TILE_SIZE / 2 - camY;
        if (dx < -40 || dx > w + 40 || dy < -40 || dy > h + 40) return;
        
        // Floating bob animation
        const age = time - (drop.droppedAt || 0);
        const bob = Math.sin(time / 400 + drop.x) * 3;
        
        // Glow effect
        const glowAlpha = 0.3 + Math.sin(time / 500 + drop.y) * 0.15;
        ctx.save();
        
        // Determine icon/color based on item
        let icon = "📦";
        let glowColor = "rgba(255, 215, 0, " + glowAlpha + ")";
        const it = ITEMS[drop.itemId];
        if (drop.itemId === "gold") {
          icon = "🪙";
          glowColor = "rgba(255, 215, 0, " + glowAlpha + ")";
        } else if (it) {
          icon = it.icon;
          if (it.equipSlot) {
            glowColor = "rgba(100, 200, 255, " + glowAlpha + ")"; // blue glow for equipment
          } else {
            glowColor = "rgba(50, 255, 50, " + glowAlpha + ")"; // green glow for consumables
          }
        }
        
        // Draw glow circle
        ctx.beginPath();
        ctx.arc(dx, dy + bob - 4, 14, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();
        
        // Draw item icon
        ctx.font = "18px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(icon, dx, dy + bob - 4);
        
        // Draw quantity if > 1
        if (drop.quantity > 1) {
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 2;
          const qText = drop.itemId === "gold" ? `${drop.quantity}g` : `x${drop.quantity}`;
          ctx.strokeText(qText, dx + 8, dy + bob + 6);
          ctx.fillText(qText, dx + 8, dy + bob + 6);
        }
        
        ctx.restore();
      });

      /* ── World Events ──────────────────────────────────── */
      worldEventsRef.current.forEach((evt) => {
        if (!evt.active) return;
        const ex = evt.x + TILE_SIZE / 2 - camX;
        const ey = evt.y + TILE_SIZE / 2 - camY;
        if (ex < -80 || ex > w + 80 || ey < -80 || ey > h + 80) return;

        const bob = Math.sin(time / 300 + evt.x * 0.01) * 4;
        const pulseAlpha = 0.4 + Math.sin(time / 400) * 0.2;
        const timeLeft = Math.max(0, evt.expiresAt - Date.now());
        const timerSec = Math.ceil(timeLeft / 1000);

        ctx.save();

        if (evt.eventType === "treasure_chest") {
          // Glowing gold circle
          const gradient = ctx.createRadialGradient(ex, ey + bob, 5, ex, ey + bob, 30);
          gradient.addColorStop(0, `rgba(255, 215, 0, ${pulseAlpha})`);
          gradient.addColorStop(1, "rgba(255, 215, 0, 0)");
          ctx.fillStyle = gradient;
          ctx.beginPath(); ctx.arc(ex, ey + bob, 30, 0, Math.PI * 2); ctx.fill();

          // Chest icon
          ctx.font = "28px 'Segoe UI Emoji', sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("💰", ex, ey + bob - 4);

          // Timer
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = timerSec <= 10 ? "#ff4444" : "#ffd700";
          ctx.fillText(`${timerSec}s`, ex, ey + bob + 18);

          // Label
          ctx.font = "bold 11px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#000"; ctx.fillText("Treasure Chest", ex + 1, ey + bob - 27);
          ctx.fillStyle = "#ffd700"; ctx.fillText("Treasure Chest", ex, ey + bob - 28);
        }

        if (evt.eventType === "mana_shrine") {
          // Blue/purple glow
          const glowR = 25 + Math.sin(time / 200) * 8;
          const gradient = ctx.createRadialGradient(ex, ey, 3, ex, ey, TILE_SIZE * 2.5);
          gradient.addColorStop(0, `rgba(100, 150, 255, ${pulseAlpha * 0.6})`);
          gradient.addColorStop(0.5, `rgba(80, 120, 255, ${pulseAlpha * 0.3})`);
          gradient.addColorStop(1, "rgba(80, 120, 255, 0)");
          ctx.fillStyle = gradient;
          ctx.beginPath(); ctx.arc(ex, ey, TILE_SIZE * 2.5, 0, Math.PI * 2); ctx.fill();

          // Inner glow
          const inner = ctx.createRadialGradient(ex, ey + bob, 2, ex, ey + bob, glowR);
          inner.addColorStop(0, `rgba(150, 200, 255, 0.8)`);
          inner.addColorStop(1, "rgba(100, 150, 255, 0)");
          ctx.fillStyle = inner;
          ctx.beginPath(); ctx.arc(ex, ey + bob, glowR, 0, Math.PI * 2); ctx.fill();

          // Sparkle particles around shrine
          for (let i = 0; i < 6; i++) {
            const angle = (time / 1500 + i * Math.PI / 3) % (Math.PI * 2);
            const dist = 20 + Math.sin(time / 400 + i) * 5;
            const sx = ex + Math.cos(angle) * dist;
            const sy = ey + Math.sin(angle) * dist;
            ctx.fillStyle = `rgba(180, 220, 255, ${0.5 + Math.sin(time / 200 + i) * 0.3})`;
            ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
          }

          ctx.font = "24px 'Segoe UI Emoji', sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("🔮", ex, ey + bob - 4);

          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = timerSec <= 10 ? "#ff4444" : "#88ccff";
          ctx.fillText(`${timerSec}s`, ex, ey + bob + 18);

          ctx.font = "bold 11px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#000"; ctx.fillText("Mana Shrine", ex + 1, ey + bob - 27);
          ctx.fillStyle = "#88ccff"; ctx.fillText("Mana Shrine", ex, ey + bob - 28);
        }

        if (evt.eventType === "golden_slime") {
          // Golden sparkle aura
          const gradient = ctx.createRadialGradient(ex, ey + bob, 5, ex, ey + bob, 35);
          gradient.addColorStop(0, `rgba(255, 215, 0, ${pulseAlpha * 0.8})`);
          gradient.addColorStop(0.5, `rgba(255, 230, 100, ${pulseAlpha * 0.3})`);
          gradient.addColorStop(1, "rgba(255, 215, 0, 0)");
          ctx.fillStyle = gradient;
          ctx.beginPath(); ctx.arc(ex, ey + bob, 35, 0, Math.PI * 2); ctx.fill();

          // Draw golden slime body (shimmering gold)
          const shimmer = Math.sin(time / 150) * 20;
          ctx.fillStyle = `rgb(${235 + shimmer}, ${195 + shimmer}, ${0})`;
          const size = 18 + Math.sin(time / 200) * 2; // pulsing
          ctx.beginPath();
          ctx.ellipse(ex, ey + bob + 2, size, size * 0.75, 0, 0, Math.PI * 2);
          ctx.fill();
          // Shine highlight
          ctx.fillStyle = `rgba(255, 255, 200, ${0.5 + Math.sin(time / 100) * 0.2})`;
          ctx.beginPath();
          ctx.ellipse(ex - 5, ey + bob - 4, 5, 3, -0.3, 0, Math.PI * 2);
          ctx.fill();
          // Eyes
          ctx.fillStyle = "#000";
          ctx.beginPath(); ctx.arc(ex - 5, ey + bob, 2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(ex + 5, ey + bob, 2, 0, Math.PI * 2); ctx.fill();

          // Sparkles flying off
          for (let i = 0; i < 4; i++) {
            const angle = time / 500 + i * Math.PI / 2;
            const dist = 20 + Math.sin(time / 300 + i * 2) * 8;
            const sx = ex + Math.cos(angle) * dist;
            const sy = ey + bob + Math.sin(angle) * dist * 0.6 - 5;
            ctx.fillStyle = `rgba(255, 255, 100, ${0.6 + Math.sin(time / 150 + i) * 0.3})`;
            ctx.font = "8px serif";
            ctx.fillText("✦", sx, sy);
          }

          // HP bar
          if (evt.maxHp > 0) {
            const hpW = 40;
            const hpH = 5;
            const hpX = ex - hpW / 2;
            const hpY = ey + bob + 18;
            ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(hpX - 1, hpY - 1, hpW + 2, hpH + 2);
            ctx.fillStyle = "#1a1a1a"; ctx.fillRect(hpX, hpY, hpW, hpH);
            const ratio = evt.maxHp > 0 ? evt.hp / evt.maxHp : 0;
            ctx.fillStyle = "#ffd700"; ctx.fillRect(hpX, hpY, hpW * ratio, hpH);
            ctx.font = "bold 8px 'Segoe UI', sans-serif";
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.fillText(`${evt.hp}/${evt.maxHp}`, ex, hpY + hpH + 9);
          }

          // Timer
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = timerSec <= 15 ? "#ff4444" : "#ffd700";
          ctx.textAlign = "center";
          ctx.fillText(`${timerSec}s`, ex, ey + bob - 24);

          // Label
          ctx.font = "bold 12px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#000"; ctx.fillText("✨ Golden Slime", ex + 1, ey + bob - 35);
          ctx.fillStyle = "#ffd700"; ctx.fillText("✨ Golden Slime", ex, ey + bob - 36);
        }

        if (evt.eventType === "xp_orb") {
          // Purple glow
          const gradient = ctx.createRadialGradient(ex, ey + bob, 3, ex, ey + bob, 25);
          gradient.addColorStop(0, `rgba(155, 89, 182, ${pulseAlpha * 0.9})`);
          gradient.addColorStop(0.5, `rgba(155, 89, 182, ${pulseAlpha * 0.3})`);
          gradient.addColorStop(1, "rgba(155, 89, 182, 0)");
          ctx.fillStyle = gradient;
          ctx.beginPath(); ctx.arc(ex, ey + bob, 25, 0, Math.PI * 2); ctx.fill();

          // XP orb
          ctx.font = "26px 'Segoe UI Emoji', sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("⭐", ex, ey + bob - 4);

          // Timer
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = timerSec <= 10 ? "#ff4444" : "#bb88ff";
          ctx.fillText(`${timerSec}s`, ex, ey + bob + 18);

          ctx.font = "bold 11px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#000"; ctx.fillText("XP Orb (+150)", ex + 1, ey + bob - 27);
          ctx.fillStyle = "#bb88ff"; ctx.fillText("XP Orb (+150)", ex, ey + bob - 28);
        }

        ctx.restore();
      });

      /* ── NPCs ────────────────────────────────────────── */

      for (const npc of npcsRef.current) {
        const nx = npc.x * TILE_SIZE + TILE_SIZE / 2 - camX;
        const ny = npc.y * TILE_SIZE + TILE_SIZE / 2 - camY;
        if (nx < -80 || nx > w + 80 || ny < -80 || ny > h + 80) continue;

        ctx.beginPath(); ctx.ellipse(nx, ny + 16, 14, 5, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fill();

        const tinted = getTintedSprite(npc.color);
        if (tinted) {
          const row = DIR_ROW[npc.direction] ?? DIR_ROW.down;
          ctx.drawImage(tinted, 12, row * SPRITE_H + 8, SPRITE_W - 24, SPRITE_H - 8, nx - 28, ny - 40, 56, 56);
        } else {
          ctx.beginPath(); ctx.arc(nx, ny, 20, 0, Math.PI * 2); ctx.fillStyle = npc.color; ctx.fill();
        }

        ctx.font = "bold 13px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText(npc.name, nx + 1, ny - 41);
        ctx.fillStyle = "#FFD700"; ctx.fillText(npc.name, nx, ny - 42);

        if (me) {
          const dist = Math.abs(Math.round(me.toX / TILE_SIZE) - npc.x) + Math.abs(Math.round(me.toY / TILE_SIZE) - npc.y);
          if (dist <= 2) { ctx.font = "10px 'Segoe UI', sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillText("[E] Talk", nx, ny - 54); }
        }

        // Quest markers above NPC
        const questMarker = npcQuestMarkersRef.current.get(npc.id);
        if (questMarker) {
          const bounce = Math.sin(time / 300) * 4;
          const markerY = ny - 58 + bounce;
          if (questMarker === "turnin") {
            // Yellow ? for turn-in
            ctx.font = "bold 22px 'Segoe UI', sans-serif";
            ctx.fillStyle = "#ffd700";
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 3;
            ctx.strokeText("?", nx - 1, markerY);
            ctx.fillText("?", nx - 1, markerY);
          } else if (questMarker === "available") {
            // Yellow ! for available quest
            ctx.font = "bold 22px 'Segoe UI', sans-serif";
            ctx.fillStyle = "#ffd700";
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 3;
            ctx.strokeText("!", nx - 1, markerY);
            ctx.fillText("!", nx - 1, markerY);
          }
        }
      }

      /* ── Players ─────────────────────────────────────── */

      playersRef.current.forEach((p, sid) => {
        const px = p.displayX + TILE_SIZE / 2 - camX;
        const py = p.displayY + TILE_SIZE / 2 - camY;
        if (px < -80 || px > w + 80 || py < -80 || py > h + 80) return;

        // PvP target highlight
        if (sid !== sessionIdRef.current && myTargetId === sid) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(px - TILE_SIZE / 2, py - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        }

        // Footstep dust particles when moving
        if (p.moving && p.hp > 0 && Math.random() < 0.3) {
          particlesRef.current.push({
            x: p.displayX + TILE_SIZE / 2 + (Math.random() - 0.5) * 10,
            y: p.displayY + TILE_SIZE / 2 + 16,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -Math.random() * 0.5,
            life: 15 + Math.random() * 10,
            maxLife: 25,
            color: "#c2a46e",
            size: 2 + Math.random() * 2,
          });
        }

        // Death fade effect on entire player rendering
        const isDying = p.hp <= 0 && p.deathTime > 0;
        const deathFade = isDying ? Math.max(0.15, 1 - Math.min((now - p.deathTime) / 1500, 1) * 0.85) : 1;
        if (isDying) { ctx.save(); ctx.globalAlpha = deathFade; }

        // Shadow
        ctx.beginPath(); ctx.ellipse(px, py + 16, 14, 5, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fill();

        const sprite = getClassSprite(p.playerClass);
        if (sprite) {
          const row = DIR_ROW[p.direction] ?? DIR_ROW.down;
          let frame = 0;
          if (p.moveStartTime > 0 || p.moving) frame = Math.floor(time / ANIM_SPEED) % (WALK_FRAMES - 1) + 1;
          // Crop tighter: skip 12px transparent border on each side of the 64x64 frame
          ctx.drawImage(sprite, frame * SPRITE_W + 12, row * SPRITE_H + 8, SPRITE_W - 24, SPRITE_H - 8, px - 28, py - 40, 56, 56);

        } else {
          ctx.beginPath(); ctx.arc(px, py, 20, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
        }

        // Status effect visual overlay
        if (p.statusEffect) {
          ctx.save();
          if (p.statusEffect === "poison") {
            // Green pulsing aura
            const pulse = 0.15 + Math.sin(time / 300) * 0.1;
            ctx.globalAlpha = pulse;
            ctx.fillStyle = "#00ff00";
            ctx.beginPath(); ctx.arc(px, py - 5, 28, 0, Math.PI * 2); ctx.fill();
            // Poison drip particles
            if (Math.random() < 0.15) {
              particlesRef.current.push({ x: px + (Math.random() - 0.5) * 30, y: py - 10, vx: 0, vy: 1.5, life: 600, maxLife: 600, color: "#00cc00", size: 2 });
            }
          } else if (p.statusEffect === "burn") {
            // Orange/red flickering aura
            const pulse = 0.15 + Math.sin(time / 150) * 0.12;
            ctx.globalAlpha = pulse;
            ctx.fillStyle = "#ff4400";
            ctx.beginPath(); ctx.arc(px, py - 5, 28, 0, Math.PI * 2); ctx.fill();
            // Fire particles rising
            if (Math.random() < 0.2) {
              particlesRef.current.push({ x: px + (Math.random() - 0.5) * 24, y: py, vx: (Math.random() - 0.5) * 1, vy: -2 - Math.random(), life: 500, maxLife: 500, color: Math.random() > 0.5 ? "#ff6600" : "#ffcc00", size: 3 });
            }
          }
          ctx.restore();
        }

        // Kill streak indicator above name
        if (p.killStreak >= 3) {
          const streakAlpha = 0.7 + Math.sin(time / 200) * 0.3;
          ctx.save(); ctx.globalAlpha = streakAlpha;
          ctx.font = "bold 10px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
          const streakColor = p.killStreak >= 12 ? "#ff00ff" : p.killStreak >= 8 ? "#ff0000" : p.killStreak >= 5 ? "#ff6600" : "#ff9900";
          ctx.fillStyle = streakColor;
          ctx.fillText(`🔥 ${p.killStreak} kills`, px, py - 66);
          ctx.restore();
        }

        // Name above HP bar
        const nameStr = p.level > 1 ? `${p.name} [${p.level}]` : p.name;
        ctx.font = "bold 12px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText(nameStr, px + 1, py - 53);
        ctx.fillStyle = "#fff"; ctx.fillText(nameStr, px, py - 54);

        // HP bar below name
        drawHPBar(ctx, px, py - 46, p.hp, p.maxHp, 40);

        // Status effect icon
        if (p.statusEffect) {
          ctx.font = "12px serif"; ctx.textAlign = "left";
          ctx.fillText(p.statusEffect === "poison" ? "☠️" : "🔥", px + 24, py - 43);
        }

        // MP bar (only for local player)
        if (sid === sessionIdRef.current) {
          const mpW = 40;
          const mpY = py - 42;
          ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(px - mpW / 2 - 1, mpY - 1, mpW + 2, 5);
          ctx.fillStyle = "#1a1a2e"; ctx.fillRect(px - mpW / 2, mpY, mpW, 3);
          const mpRatio = p.maxMp > 0 ? p.mp / p.maxMp : 0;
          ctx.fillStyle = "#3498db"; ctx.fillRect(px - mpW / 2, mpY, mpW * mpRatio, 3);
        }

        // Weapon glow for equipped weapon
        if (p.equipWeapon && p.hp > 0) {
          const weaponItem = ITEMS[p.equipWeapon];
          if (weaponItem) {
            ctx.save();
            const weaponColor = p.equipWeapon === "fire_staff" ? "rgba(255,100,0,0.3)" : p.equipWeapon.includes("bow") ? "rgba(139,69,19,0.2)" : "rgba(200,200,255,0.2)";
            ctx.fillStyle = weaponColor;
            const glowSize = 3 + Math.sin(time / 400) * 1;
            ctx.beginPath();
            ctx.arc(px + (p.direction === "left" ? -12 : 12), py, glowSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        if (isDying) { ctx.restore(); }

        // Death animation
        if (p.hp <= 0 && p.deathTime > 0) {
          const deathAge = now - p.deathTime;
          const DEATH_FADE_MS = 1500;
          const deathProgress = Math.min(deathAge / DEATH_FADE_MS, 1);
          ctx.save();
          // Red flash at the start
          if (deathProgress < 0.2) {
            ctx.globalAlpha = 0.4 * (1 - deathProgress / 0.2);
            ctx.fillStyle = "#ff0000";
            ctx.beginPath();
            ctx.arc(px, py, 30, 0, Math.PI * 2);
            ctx.fill();
          }
          // Fade + fall
          ctx.globalAlpha = Math.max(0.1, 1 - deathProgress * 0.8);
          ctx.translate(px, py);
          ctx.rotate(deathProgress * 1.2); // tilt over
          ctx.translate(-px, -py);
          ctx.font = "24px serif";
          ctx.textAlign = "center";
          ctx.fillText("💀", px, py + 5 + deathProgress * 15);
          ctx.restore();
        }
      });

      /* ── Chat bubbles ────────────────────────────────── */

      for (const bubble of chatBubblesRef.current) {
        const p = playersRef.current.get(bubble.sessionId);
        if (!p) continue;
        const bx = p.displayX + TILE_SIZE / 2 - camX;
        const by = p.displayY + TILE_SIZE / 2 - camY;
        const age = now - bubble.time;
        drawBubble(ctx, bubble.message, bx, by - 62, 200, age > CHAT_DURATION - 500 ? (CHAT_DURATION - age) / 500 : 1);
      }

      /* ── Emote bubbles ───────────────────────────────── */

      for (const emote of emoteBubblesRef.current) {
        const p = playersRef.current.get(emote.sessionId);
        if (!p) continue;
        const ex = p.displayX + TILE_SIZE / 2 - camX;
        const progress = (now - emote.time) / EMOTE_DURATION;
        ctx.save();
        ctx.globalAlpha = progress > 0.7 ? (1 - progress) / 0.3 : 1;
        ctx.font = "28px serif"; ctx.textAlign = "center";
        ctx.fillText(emote.emote, ex, p.displayY + TILE_SIZE / 2 - camY - 65 - progress * 30);
        ctx.restore();
      }

      /* ── Projectiles (arrows) ─────────────────────────── */

      for (const proj of projectilesRef.current) {
        const progress = Math.min((now - proj.time) / 300, 1);
        const ax = proj.fromX + (proj.toX - proj.fromX) * progress - camX;
        const ay = proj.fromY + (proj.toY - proj.fromY) * progress - camY;
        const angle = Math.atan2(proj.toY - proj.fromY, proj.toX - proj.fromX);

        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        // Arrow shaft
        ctx.strokeStyle = "#8B4513";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(8, 0); ctx.stroke();
        // Arrowhead
        ctx.fillStyle = "#C0C0C0";
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(6, -4);
        ctx.lineTo(6, 4);
        ctx.closePath();
        ctx.fill();
        // Fletching
        ctx.fillStyle = "#e74c3c";
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(-16, -3);
        ctx.lineTo(-14, 0);
        ctx.lineTo(-16, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      /* ── Damage numbers ──────────────────────────────── */

      for (const dmg of damageNumbersRef.current) {
        const progress = (now - dmg.time) / DAMAGE_DURATION;
        const alpha = progress > 0.6 ? (1 - progress) / 0.4 : 1;
        // Bounce: starts fast, slows down
        const bounce = progress < 0.15 ? -Math.sin(progress / 0.15 * Math.PI) * 8 : 0;
        const floatY = dmg.y - camY - progress * 45 + bounce;
        // Scale for big hits
        const isBigHit = dmg.damage >= 30;
        const sizeBoost = isBigHit ? Math.max(1, 1.5 - progress) : 1;
        const fontSize = Math.round((isBigHit ? 22 : 16) * sizeBoost);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
        ctx.textAlign = "center";
        const dmgText = dmg.damage > 0 ? `${dmg.prefix || "-"}${dmg.damage}` : (dmg.prefix || "");
        // Shadow for readability
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillText(dmgText, dmg.x - camX + 1, floatY + 1);
        ctx.fillStyle = dmg.color || "#e74c3c";
        ctx.fillText(dmgText, dmg.x - camX, floatY);
        // Extra glow for big hits
        if (isBigHit && progress < 0.3) {
          ctx.globalAlpha = alpha * 0.3;
          ctx.font = `bold ${fontSize + 4}px 'Segoe UI', sans-serif`;
          ctx.fillStyle = "#fff";
          ctx.fillText(dmgText, dmg.x - camX, floatY);
        }
        ctx.restore();
      }

      /* ── Particles ─────────────────────────────────────── */
      for (const part of particlesRef.current) {
        const alpha = part.life / part.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = part.color;
        ctx.beginPath();
        ctx.arc(part.x - camX, part.y - camY, part.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* ── Level-up effects ────────────────────────────── */
      for (const lvl of levelUpEffectsRef.current) {
        const p = playersRef.current.get(lvl.sessionId);
        if (!p) continue;
        const age = now - lvl.time;
        const alpha = age > 1500 ? (2000 - age) / 500 : Math.min(age / 200, 1);
        const px = p.displayX + TILE_SIZE / 2 - camX;
        const py = p.displayY + TILE_SIZE / 2 - camY;
        ctx.save();
        ctx.globalAlpha = alpha;
        // Glowing ring
        const ringRadius = 20 + (age / 2000) * 30;
        ctx.strokeStyle = "#f1c40f";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py - 10, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        // Level up text
        ctx.font = "bold 16px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#f1c40f";
        ctx.fillText(`⭐ LEVEL ${lvl.level}!`, px, py - 70 - age / 50);
        ctx.restore();
      }

      /* ── NPC dialogue ────────────────────────────────── */

      const dlg = npcDialogueRef.current;
      if (dlg) {
        const age = now - dlg.time;
        const alpha = age > NPC_DIALOGUE_DURATION - 500 ? (NPC_DIALOGUE_DURATION - age) / 500 : Math.min(age / 200, 1);
        ctx.save(); ctx.globalAlpha = alpha;
        const boxW = Math.min(400, w - 40), boxH = 70;
        const boxX = w / 2 - boxW / 2, boxY = h - (isMobile ? 240 : 120);
        ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 10); ctx.fill();
        ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = "bold 14px 'Segoe UI', sans-serif"; ctx.fillStyle = "#FFD700"; ctx.textAlign = "left";
        ctx.fillText(dlg.name, boxX + 14, boxY + 22);
        ctx.font = "13px 'Segoe UI', sans-serif"; ctx.fillStyle = "#eee";
        ctx.fillText(dlg.message, boxX + 14, boxY + 48, boxW - 28);
        ctx.restore();
      }

      /* ── Kill feed (top right) ───────────────────────── */

      killFeedRef.current.forEach((kf, i) => {
        const age = now - kf.time;
        const alpha = age > 4000 ? (5000 - age) / 1000 : Math.min(age / 200, 1);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.font = "12px 'Segoe UI', sans-serif"; ctx.textAlign = "right";
        ctx.fillStyle = "#FFD700";
        ctx.fillText(kf.text, w - 10, 50 + i * 18);
        ctx.restore();
      });

      /* ── Loot notifications (left side, above HUD) ──── */

      lootNotifRef.current.forEach((ln, i) => {
        const age = now - ln.time;
        const alpha = age > 2500 ? (3000 - age) / 500 : Math.min(age / 150, 1);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.font = "bold 13px 'Segoe UI', sans-serif"; ctx.textAlign = "left";
        ctx.fillStyle = "#2ecc71";
        ctx.fillText(`+ ${ln.text}`, 12, h - 100 - i * 20);
        ctx.restore();
      });

      /* ── Quest Tracker (top-left, below player count) ── */
      
      const activeQuests = questTrackerRef.current;
      if (activeQuests.length > 0) {
        const qStartY = 52;
        ctx.save();
        // Background panel
        const panelH = activeQuests.length * 28 + 22;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.roundRect(6, qStartY - 16, 200, panelH, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,215,0,0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = "bold 11px 'Segoe UI', sans-serif";
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffd700";
        ctx.fillText("📜 Quests", 14, qStartY - 2);

        activeQuests.forEach((q, i) => {
          const qy = qStartY + 14 + i * 28;
          const isComplete = q.completed;
          ctx.font = "12px 'Segoe UI', sans-serif";
          ctx.fillStyle = isComplete ? "#2ecc71" : "#ddd";
          ctx.fillText(`${q.icon} ${q.name}`, 14, qy);
          ctx.font = "10px 'Segoe UI', sans-serif";
          ctx.fillStyle = isComplete ? "#2ecc71" : "#aaa";
          const progressText = isComplete ? "✅ Complete!" : `${q.progress}/${q.required} ${q.killTarget}s`;
          ctx.fillText(progressText, 22, qy + 14);
          // Progress bar
          if (!isComplete) {
            const barX = 140, barY = qy + 6, barW = 58, barH = 6;
            ctx.fillStyle = "rgba(255,255,255,0.1)";
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = "#3498db";
            ctx.fillRect(barX, barY, barW * (q.progress / q.required), barH);
          }
        });
        ctx.restore();
      }

      // NPC quest markers are now driven by server via npc_quest_markers message
      // (npcQuestMarkersRef is updated in the message handler)

      /* ── Quest Notifications (right side) ──── */
      
      questNotifRef.current = questNotifRef.current.filter(n => now - n.time < 4000);
      questNotifRef.current.forEach((qn, i) => {
        const age = now - qn.time;
        const alpha = age > 3500 ? (4000 - age) / 500 : Math.min(age / 150, 1);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.font = "bold 13px 'Segoe UI', sans-serif"; ctx.textAlign = "right";
        ctx.fillStyle = qn.color;
        ctx.fillText(qn.text, w - 12, h / 2 - 60 - i * 22);
        ctx.restore();
      });

      /* ── World Event Notifications (top center banner) ──── */
      worldEventNotifsRef.current.forEach((notif, i) => {
        const age = now - notif.time;
        const alpha = age < 200 ? age / 200 : age > 4500 ? (5000 - age) / 500 : 1;
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;

        const text = notif.message;
        ctx.font = "bold 14px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        const textW = ctx.measureText(text).width;
        const bannerW = textW + 30;
        const bannerH = 28;
        const bannerX = w / 2 - bannerW / 2;
        const bannerY = 55 + i * 36;

        // Banner background
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.beginPath();
        ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 6);
        ctx.fill();
        // Border glow
        ctx.strokeStyle = notif.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 6);
        ctx.stroke();

        // Text
        ctx.fillStyle = notif.color;
        ctx.fillText(text, w / 2, bannerY + 19);
        ctx.restore();
      });

      /* ── Kill Streak Banner (dramatic center screen) ──── */
      const streakBanner = streakBannerRef.current;
      if (streakBanner) {
        const age = now - streakBanner.time;
        if (age > 3500) {
          streakBannerRef.current = null;
        } else {
          const fadeIn = Math.min(age / 200, 1);
          const fadeOut = age > 3000 ? (3500 - age) / 500 : 1;
          const alpha = fadeIn * fadeOut;
          const scale = age < 300 ? 0.5 + (age / 300) * 0.5 : 1;
          const slideY = age < 300 ? -20 * (1 - age / 300) : 0;

          ctx.save();
          ctx.globalAlpha = alpha;

          // Banner position
          const bannerY = h * 0.25 + slideY;

          // Title text (large, colored by streak level)
          const colors = ["#ff6600", "#ff3300", "#ff0000", "#ff00ff", "#ffd700"];
          const colorIdx = Math.min(Math.floor((streakBanner.streak - 3) / 3), colors.length - 1);
          const streakColor = colors[colorIdx];

          // Glow effect
          ctx.shadowColor = streakColor;
          ctx.shadowBlur = 20 + Math.sin(now / 100) * 5;

          ctx.font = `bold ${Math.floor(28 * scale)}px 'Segoe UI', sans-serif`;
          ctx.textAlign = "center";

          // Title
          ctx.fillStyle = "#000";
          ctx.fillText(streakBanner.title, w / 2 + 2, bannerY + 2);
          ctx.fillStyle = streakColor;
          ctx.fillText(streakBanner.title, w / 2, bannerY);

          // Name and bonus
          ctx.shadowBlur = 0;
          ctx.font = `bold ${Math.floor(16 * scale)}px 'Segoe UI', sans-serif`;
          const subtitle = streakBanner.isMine
            ? `${streakBanner.streak} kills! +${streakBanner.xpBonus} XP, +${streakBanner.goldBonus} gold`
            : `${streakBanner.name} — ${streakBanner.streak} kills!`;
          ctx.fillStyle = "#000";
          ctx.fillText(subtitle, w / 2 + 1, bannerY + 26);
          ctx.fillStyle = "#fff";
          ctx.fillText(subtitle, w / 2, bannerY + 25);

          ctx.restore();
        }
      }

      /* ── Fishing UI ──── */
      const fish = fishingRef.current;
      if (fish.active) {
        const elapsed = now - fish.castTime;
        const progress = Math.min(elapsed / fish.duration, 1);
        const barW = 160, barH = 16;
        const barX = w / 2 - barW / 2;
        const barY = h / 2 + 60;
        
        // Background
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.strokeStyle = "rgba(100,180,255,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(barX - 10, barY - 28, barW + 20, barH + 44, 8);
        ctx.fill();
        ctx.stroke();
        
        // "Fishing..." text with animated dots
        const dots = ".".repeat(Math.floor(time / 400) % 4);
        ctx.font = "bold 14px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#7ec8e3";
        ctx.fillText(`🎣 Fishing${dots}`, w / 2, barY - 8);
        
        // Progress bar background
        ctx.fillStyle = "rgba(50,80,120,0.6)";
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 4);
        ctx.fill();
        
        // Progress bar fill (water-blue with shimmer)
        const shimmer = 0.8 + Math.sin(time / 150) * 0.2;
        ctx.fillStyle = `rgba(${Math.floor(60 * shimmer)}, ${Math.floor(160 * shimmer)}, ${Math.floor(255 * shimmer)}, 0.9)`;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW * progress, barH, 4);
        ctx.fill();
        
        // Bobber icon at progress position
        const bobberX = barX + barW * progress;
        const bobberBob = Math.sin(time / 200) * 2;
        ctx.font = "16px 'Segoe UI Emoji'";
        ctx.textAlign = "center";
        ctx.fillText("🎣", bobberX, barY + barH + 14 + bobberBob);
        
        ctx.restore();
      }
      
      // Fishing result notification
      if (fish.result && now - fish.resultTime < 3000) {
        const age = now - fish.resultTime;
        const alpha = age > 2500 ? (3000 - age) / 500 : Math.min(age / 200, 1);
        const floatY = Math.min(age / 10, 20);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = "bold 15px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = fish.result.includes("got away") || fish.result.includes("full") || fish.result.includes("need to") ? "#e74c3c" : "#2ecc71";
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 3;
        ctx.strokeText(fish.result, w / 2, h / 2 + 40 - floatY);
        ctx.fillText(fish.result, w / 2, h / 2 + 40 - floatY);
        ctx.restore();
      }

      /* ── HUD ─────────────────────────────────────────── */

      ctx.font = "12px monospace"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.textAlign = "left";
      ctx.fillText(`Players: ${playersRef.current.size}`, 10, 20);
      if (me) {
        ctx.fillText(`Tile: ${Math.round(me.toX / TILE_SIZE)}, ${Math.round(me.toY / TILE_SIZE)}`, 10, 36);

        // Target info frame (top-center)
        if (myTargetId && !isMobile) {
          let targetName = "";
          let targetHp = 0, targetMaxHp = 0;
          let targetColor = "#fff";
          const tSlime = slimesRef.current.get(myTargetId);
          if (tSlime && tSlime.alive) { targetName = "Slime"; targetHp = tSlime.hp; targetMaxHp = tSlime.maxHp; targetColor = tSlime.color; }
          const tWolf = wolvesRef.current.get(myTargetId);
          if (tWolf && tWolf.alive) { targetName = "Wolf"; targetHp = tWolf.hp; targetMaxHp = tWolf.maxHp; targetColor = "#ff6b6b"; }
          const tGoblin = goblinsRef.current.get(myTargetId);
          if (tGoblin && tGoblin.alive) { targetName = tGoblin.variant === "shaman" ? "Goblin Shaman" : tGoblin.variant === "archer" ? "Goblin Archer" : "Goblin"; targetHp = tGoblin.hp; targetMaxHp = tGoblin.maxHp; targetColor = "#7dcea0"; }
          const tSkeleton = skeletonsRef.current.get(myTargetId);
          if (tSkeleton && tSkeleton.alive) { targetName = "Skeleton"; targetHp = tSkeleton.hp; targetMaxHp = tSkeleton.maxHp; targetColor = "#bdc3c7"; }
          const tPlayer = myTargetId !== sessionIdRef.current ? playersRef.current.get(myTargetId) : null;
          if (tPlayer && tPlayer.hp > 0) { targetName = `${tPlayer.name} [${tPlayer.level}]`; targetHp = tPlayer.hp; targetMaxHp = tPlayer.maxHp; targetColor = "#e74c3c"; }
          const tEvent = worldEventsRef.current.get(myTargetId);
          if (tEvent && tEvent.active && tEvent.eventType === "golden_slime" && tEvent.hp > 0) { targetName = "✨ Golden Slime"; targetHp = tEvent.hp; targetMaxHp = tEvent.maxHp; targetColor = "#ffd700"; }

          if (targetName) {
            const tfW = 200, tfH = 44;
            const tfX = w / 2 - tfW / 2, tfY = 40;
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = "rgba(0,0,0,0.75)";
            ctx.beginPath(); ctx.roundRect(tfX, tfY, tfW, tfH, 6); ctx.fill();
            ctx.strokeStyle = "rgba(255,50,50,0.6)"; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.roundRect(tfX, tfY, tfW, tfH, 6); ctx.stroke();
            ctx.globalAlpha = 1;
            // Name
            ctx.font = "bold 13px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
            ctx.fillStyle = targetColor;
            ctx.fillText(targetName, tfX + tfW / 2, tfY + 16);
            // HP bar
            const hpW = tfW - 24, hpH = 8;
            const hpX = tfX + 12, hpY = tfY + 24;
            ctx.fillStyle = "#1a1a1a"; ctx.fillRect(hpX, hpY, hpW, hpH);
            const hpPct = Math.max(0, targetHp / targetMaxHp);
            const hpCol = hpPct > 0.5 ? "#2ecc71" : hpPct > 0.25 ? "#f39c12" : "#e74c3c";
            ctx.fillStyle = hpCol; ctx.fillRect(hpX, hpY, hpW * hpPct, hpH);
            ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1; ctx.strokeRect(hpX, hpY, hpW, hpH);
            // HP text
            ctx.font = "9px monospace"; ctx.fillStyle = "#ccc"; ctx.textAlign = "center";
            ctx.fillText(`${targetHp} / ${targetMaxHp}`, tfX + tfW / 2, tfY + 40);
            ctx.restore();
          }
        }

        // Player stats bar (bottom-left on desktop)
        if (!isMobile) {
          const barY = h - 50;
          // HP
          ctx.font = "bold 12px 'Segoe UI', sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "left";
          ctx.fillText(`HP`, 10, barY);
          drawHPBar(ctx, 95, barY - 5, me.hp, me.maxHp, 120);
          ctx.font = "10px monospace"; ctx.fillStyle = "#ccc";
          ctx.fillText(`${me.hp}/${me.maxHp}`, 165, barY);

          // MP
          ctx.font = "bold 12px 'Segoe UI', sans-serif"; ctx.fillStyle = "#7ec8e3"; ctx.textAlign = "left";
          ctx.fillText(`MP`, 10, barY + 16);
          // Mana bar (same width as HP bar)
          ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(34, barY + 8, 122, 7);
          ctx.fillStyle = "#1a1a2e"; ctx.fillRect(35, barY + 9, 120, 5);
          ctx.fillStyle = "#3498db"; ctx.fillRect(35, barY + 9, 120 * (me.mp / (me.maxMp || 1)), 5);
          ctx.font = "10px monospace"; ctx.fillStyle = "#ccc";
          ctx.fillText(`${me.mp}/${me.maxMp}`, 165, barY + 16);

          // XP
          ctx.font = "bold 12px 'Segoe UI', sans-serif"; ctx.fillStyle = "#fff";
          ctx.fillText(`XP`, 10, barY + 32);
          const currentLvlXp = xpForLevel(me.level);
          const nextLvlXp = xpForLevel(me.level + 1);
          const xpInLevel = me.xp - currentLvlXp;
          const xpNeeded = nextLvlXp - currentLvlXp;
          ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(34, barY + 24, 122, 7);
          ctx.fillStyle = "#1a1a2e"; ctx.fillRect(35, barY + 25, 120, 5);
          ctx.fillStyle = "#f1c40f"; ctx.fillRect(35, barY + 25, 120 * (xpInLevel / xpNeeded), 5);
          ctx.font = "10px monospace"; ctx.fillStyle = "#ccc";
          ctx.fillText(`Lv.${me.level} (${xpInLevel}/${xpNeeded})`, 165, barY + 32);

          // Gold
          ctx.font = "bold 12px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#f1c40f";
          ctx.textAlign = "left";
          ctx.fillText(`💰 ${me.gold}`, 10, barY + 46);
        }

        // ── Spell bar (centered bottom, desktop only) ────────────────
        if (!isMobile) {
        const SLOT_SIZE = 52;
        const SLOT_GAP = 6;
        const SLOT_COUNT = 4;
        const barW = SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
        const barX = Math.floor(w / 2 - barW / 2);
        const barBY = h - SLOT_SIZE - 12;

        const isRanger = me.playerClass === "ranger";
        const ATTACK_SPELL_COST = 30;
        const cdNow = Date.now();
        const getCooldownPct = (ability: string): number => {
          const endTime = abilityCooldownsRef.current.get(ability);
          if (!endTime || cdNow >= endTime) return 0;
          // Estimate total cooldown from known durations
          const durations: Record<string, number> = { shield_wall: 20000, war_cry: 25000, frost_arrow: 12000, rain_of_arrows: 18000 };
          const total = durations[ability] || 15000;
          const remaining = endTime - cdNow;
          return Math.min(1, remaining / total);
        };
        const isOnCooldown = (ability: string): boolean => {
          const endTime = abilityCooldownsRef.current.get(ability);
          return !!endTime && cdNow < endTime;
        };

        const spells = [
          { key: "1", icon: "💚", name: "Heal", cost: HEAL_COST, active: true, canUse: me.mp >= HEAL_COST && me.hp < me.maxHp, cooldownPct: 0 },
          { key: "2", icon: isRanger ? "🏹" : "⚔️", name: isRanger ? "P.Shot" : "Cleave", cost: ATTACK_SPELL_COST, active: true, canUse: me.mp >= ATTACK_SPELL_COST && (isRanger ? !!me.targetId : true), cooldownPct: 0 },
          { key: "3", icon: isRanger ? "❄️" : "🛡️", name: isRanger ? "Frost" : "Shield",
            cost: isRanger ? 25 : 40, active: true,
            canUse: me.mp >= (isRanger ? 25 : 40) && !isOnCooldown(isRanger ? "frost_arrow" : "shield_wall") && (isRanger ? !!me.targetId : true),
            cooldownPct: getCooldownPct(isRanger ? "frost_arrow" : "shield_wall"),
            cdAbility: isRanger ? "frost_arrow" : "shield_wall",
          },
          { key: "4", icon: isRanger ? "🌧️" : "📢", name: isRanger ? "Rain" : "WarCry",
            cost: isRanger ? 45 : 35, active: true,
            canUse: me.mp >= (isRanger ? 45 : 35) && !isOnCooldown(isRanger ? "rain_of_arrows" : "war_cry") && (isRanger ? !!me.targetId : true),
            cooldownPct: getCooldownPct(isRanger ? "rain_of_arrows" : "war_cry"),
            cdAbility: isRanger ? "rain_of_arrows" : "war_cry",
          },
          { key: "5", icon: "❤️", name: "HP Pot", cost: 0, active: true, canUse: me.hp < me.maxHp && me.inventory.some(s => s.itemId === "health_potion" && s.quantity > 0), count: me.inventory.reduce((n, s) => s.itemId === "health_potion" ? n + s.quantity : n, 0), cooldownPct: 0 },
          { key: "6", icon: "💙", name: "MP Pot", cost: 0, active: true, canUse: me.mp < me.maxMp && me.inventory.some(s => s.itemId === "mana_potion" && s.quantity > 0), count: me.inventory.reduce((n, s) => s.itemId === "mana_potion" ? n + s.quantity : n, 0), cooldownPct: 0 },
        ];

        // Recalculate bar dimensions for 6 slots
        const SLOT_COUNT_REAL = spells.length;
        const barWReal = SLOT_COUNT_REAL * SLOT_SIZE + (SLOT_COUNT_REAL - 1) * SLOT_GAP;
        const barXReal = Math.floor(w / 2 - barWReal / 2);

        for (let i = 0; i < spells.length; i++) {
          const spell = spells[i] as any;
          const sx = barXReal + i * (SLOT_SIZE + SLOT_GAP);

          // Slot background
          ctx.fillStyle = spell.active ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.4)";
          ctx.beginPath();
          ctx.roundRect(sx, barBY, SLOT_SIZE, SLOT_SIZE, 6);
          ctx.fill();

          // Cooldown sweep overlay (clock-sweep from top)
          if (spell.cooldownPct > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(sx, barBY, SLOT_SIZE, SLOT_SIZE, 6);
            ctx.clip();

            const cx = sx + SLOT_SIZE / 2;
            const cy = barBY + SLOT_SIZE / 2;
            const r = SLOT_SIZE;
            const startAngle = -Math.PI / 2;
            const sweepAngle = spell.cooldownPct * Math.PI * 2;

            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, startAngle, startAngle + sweepAngle);
            ctx.closePath();
            ctx.fill();

            // Cooldown seconds remaining
            const cdEnd = abilityCooldownsRef.current.get(spell.cdAbility || "");
            if (cdEnd) {
              const secLeft = Math.ceil((cdEnd - cdNow) / 1000);
              if (secLeft > 0) {
                ctx.font = "bold 16px 'Segoe UI', sans-serif";
                ctx.textAlign = "center";
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                ctx.fillText(`${secLeft}`, cx, cy + 6);
              }
            }
            ctx.restore();
          }

          // Border (green if usable, orange if on cooldown, gray otherwise)
          ctx.strokeStyle = spell.canUse ? "rgba(46,204,113,0.8)" : spell.cooldownPct > 0 ? "rgba(243,156,18,0.6)" : spell.active ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(sx, barBY, SLOT_SIZE, SLOT_SIZE, 6);
          ctx.stroke();

          // Icon (dim if on cooldown)
          if (spell.icon) {
            ctx.font = "22px serif";
            ctx.textAlign = "center";
            ctx.globalAlpha = spell.cooldownPct > 0 ? 0.3 : spell.canUse ? 1 : 0.4;
            ctx.fillText(spell.icon, sx + SLOT_SIZE / 2, barBY + 28);
            ctx.globalAlpha = 1;
          }

          // Mana cost or potion count
          if (spell.active && spell.cost > 0 && spell.cooldownPct === 0) {
            ctx.font = "9px 'Segoe UI', sans-serif";
            ctx.fillStyle = spell.canUse ? "#7ec8e3" : "rgba(126,200,227,0.4)";
            ctx.textAlign = "center";
            ctx.fillText(`${spell.cost} MP`, sx + SLOT_SIZE / 2, barBY + SLOT_SIZE - 5);
          } else if (spell.active && spell.count !== undefined) {
            ctx.font = "bold 10px 'Segoe UI', sans-serif";
            ctx.fillStyle = spell.count > 0 ? "#f1c40f" : "rgba(241,196,15,0.3)";
            ctx.textAlign = "center";
            ctx.fillText(`×${spell.count}`, sx + SLOT_SIZE / 2, barBY + SLOT_SIZE - 5);
          }

          // Ability name (below icon for new abilities)
          if (i >= 2 && i <= 3 && spell.cooldownPct === 0) {
            ctx.font = "7px 'Segoe UI', sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.textAlign = "center";
            ctx.fillText(spell.name, sx + SLOT_SIZE / 2, barBY + SLOT_SIZE - 5);
          }

          // Key number
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.textAlign = "left";
          ctx.fillText(spell.key, sx + 4, barBY + 12);
        }
      }
      } // end desktop spell bar

      if (!isMobile) {
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "12px monospace"; ctx.textAlign = "right";
        ctx.fillText("WASD: Move | Click: Target | E: Talk | 1-6: Abilities | M: Mute | Enter: Chat | Esc: Untarget", w - 10, 20);
      }

      // Sound indicator
      if (isMuted()) {
        ctx.font = "11px 'Segoe UI', sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.textAlign = "left";
        ctx.fillText("🔇 Muted (M)", 10, 52);
      }

      /* ── Day/Night cycle overlay ─────────────────────── */
      {
        // Full day cycle = 10 real minutes (600s)
        const DAY_CYCLE_MS = 600000;
        const cyclePos = (Date.now() % DAY_CYCLE_MS) / DAY_CYCLE_MS; // 0-1
        // 0.0-0.25 = dawn, 0.25-0.5 = day, 0.5-0.75 = dusk, 0.75-1.0 = night
        let nightAlpha = 0;
        let tintR = 0, tintG = 0, tintB = 0;
        if (cyclePos < 0.2) {
          // Dawn: dark → light, warm orange tint (subtle)
          const t = cyclePos / 0.2;
          nightAlpha = 0.14 * (1 - t);
          tintR = 255; tintG = 140; tintB = 50;
        } else if (cyclePos < 0.5) {
          // Day: clear, no overlay
          nightAlpha = 0;
        } else if (cyclePos < 0.65) {
          // Dusk: light → getting dark, warm red/purple tint (subtle)
          const t = (cyclePos - 0.5) / 0.15;
          nightAlpha = 0.12 * t;
          tintR = Math.floor(200 + 55 * (1 - t)); tintG = Math.floor(80 * (1 - t)); tintB = Math.floor(120 * t);
        } else {
          // Night: dark blue overlay (subtle)
          const t = Math.min((cyclePos - 0.65) / 0.1, 1);
          nightAlpha = 0.12 + 0.06 * t;
          tintR = 20; tintG = 20; tintB = 80;
        }
        if (nightAlpha > 0.01) {
          ctx.save();
          ctx.globalAlpha = nightAlpha;
          ctx.fillStyle = `rgb(${tintR},${tintG},${tintB})`;
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }

        // Time indicator (small clock icon in minimap area)
        const timeNames = cyclePos < 0.2 ? "🌅 Dawn" : cyclePos < 0.5 ? "☀️ Day" : cyclePos < 0.65 ? "🌇 Dusk" : "🌙 Night";
        ctx.font = "10px 'Segoe UI', sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.textAlign = "right";
        ctx.fillText(timeNames, w - 12, isMobile ? 46 : 24);
      }

      /* ── Minimap (top-right corner) ──────────────────── */
      if (me && worldMapRef.current) {
        const mmW = isMobile ? 100 : 140;
        const mmH = mmW;
        const mmX = w - mmW - 10;
        const mmY = isMobile ? 50 : 30;
        const mw = mapSizeRef.current.w;
        const mh = mapSizeRef.current.h;
        const pxPerTileX = mmW / mw;
        const pxPerTileY = mmH / mh;

        // Background
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#0a1a05";
        ctx.beginPath();
        ctx.roundRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4, 4);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Draw terrain pixels
        const map = worldMapRef.current;
        const MINIMAP_COLORS: Record<number, string> = {
          0: "#2d5a1e", 1: "#c2a46e", 2: "#1e64c8", 3: "#1a4a0a",
          4: "#757575", 5: "#3d7a1e", 6: "#8D6E63", 7: "#795548",
          8: "#A1887F", 9: "#F5E6CA",
        };
        for (let ty = 0; ty < mh; ty++) {
          for (let tx = 0; tx < mw; tx++) {
            const tile = map[ty]?.[tx] ?? 0;
            ctx.fillStyle = MINIMAP_COLORS[tile] || "#2d5a1e";
            ctx.fillRect(mmX + tx * pxPerTileX, mmY + ty * pxPerTileY, Math.ceil(pxPerTileX), Math.ceil(pxPerTileY));
          }
        }

        // Monster dots (red for wolves, colored for slimes)
        slimesRef.current.forEach((s) => {
          if (!s.alive) return;
          const stx = s.displayX / TILE_SIZE;
          const sty = s.displayY / TILE_SIZE;
          ctx.fillStyle = s.color;
          ctx.fillRect(mmX + stx * pxPerTileX - 1, mmY + sty * pxPerTileY - 1, 2, 2);
        });
        wolvesRef.current.forEach((wolf) => {
          if (!wolf.alive) return;
          const wtx = wolf.displayX / TILE_SIZE;
          const wty = wolf.displayY / TILE_SIZE;
          ctx.fillStyle = "#ff3333";
          ctx.fillRect(mmX + wtx * pxPerTileX - 1, mmY + wty * pxPerTileY - 1, 3, 3);
        });

        // Goblin dots (green)
        goblinsRef.current.forEach((g) => {
          if (!g.alive) return;
          ctx.fillStyle = "#4a8c3f";
          ctx.fillRect(mmX + (g.displayX / TILE_SIZE) * pxPerTileX - 1, mmY + (g.displayY / TILE_SIZE) * pxPerTileY - 1, 2, 2);
        });
        // Skeleton dots (white)
        skeletonsRef.current.forEach((sk) => {
          if (!sk.alive) return;
          ctx.fillStyle = "#e0e0e0";
          ctx.fillRect(mmX + (sk.displayX / TILE_SIZE) * pxPerTileX - 1, mmY + (sk.displayY / TILE_SIZE) * pxPerTileY - 1, 3, 3);
        });

        // Boss dots (large, pulsing red)
        bossesRef.current.forEach((b) => {
          if (!b.alive) return;
          const btx = b.displayX / TILE_SIZE;
          const bty = b.displayY / TILE_SIZE;
          const bossSize = 3 + Math.sin(time / 200) * 1;
          ctx.fillStyle = "#ff0000";
          ctx.beginPath(); ctx.arc(mmX + btx * pxPerTileX, mmY + bty * pxPerTileY, bossSize, 0, Math.PI * 2); ctx.fill();
        });

        // Other players (blue dots)
        playersRef.current.forEach((p, sid) => {
          if (sid === sessionIdRef.current) return;
          const ptx = p.displayX / TILE_SIZE;
          const pty = p.displayY / TILE_SIZE;
          ctx.fillStyle = "#3498db";
          ctx.fillRect(mmX + ptx * pxPerTileX - 1, mmY + pty * pxPerTileY - 1, 3, 3);
        });

        // World event markers (pulsing gold stars)
        worldEventsRef.current.forEach((evt) => {
          if (!evt.active) return;
          const etx = evt.x / TILE_SIZE;
          const ety = evt.y / TILE_SIZE;
          const evtSize = 3 + Math.sin(time / 150) * 1.5;
          const colors: Record<string, string> = {
            treasure_chest: "#ffd700",
            mana_shrine: "#6699ff",
            golden_slime: "#ffee00",
            xp_orb: "#bb88ff",
          };
          ctx.fillStyle = colors[evt.eventType] || "#ffd700";
          ctx.beginPath();
          ctx.arc(mmX + etx * pxPerTileX, mmY + ety * pxPerTileY, evtSize, 0, Math.PI * 2);
          ctx.fill();
          // Add a small outline for visibility
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = 0.5;
          ctx.stroke();
        });

        // Player dot (white, pulsing)
        const myTx = me.displayX / TILE_SIZE;
        const myTy = me.displayY / TILE_SIZE;
        const dotSize = 2 + Math.sin(time / 300) * 1;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(mmX + myTx * pxPerTileX, mmY + myTy * pxPerTileY, dotSize, 0, Math.PI * 2);
        ctx.fill();

        // Camera viewport rectangle
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1;
        const vpLeft = camX / TILE_SIZE;
        const vpTop = camY / TILE_SIZE;
        const vpW = w / TILE_SIZE;
        const vpH = h / TILE_SIZE;
        ctx.strokeRect(
          mmX + vpLeft * pxPerTileX,
          mmY + vpTop * pxPerTileY,
          vpW * pxPerTileX,
          vpH * pxPerTileY
        );

        ctx.restore();
      }

      // Update React state for HUD overlay (throttled)
      if (me && Math.floor(time / 500) !== Math.floor((time - 16) / 500)) {
        setMyStats({ hp: me.hp, maxHp: me.maxHp, xp: me.xp, level: me.level, playerClass: me.playerClass, targetId: me.targetId, isHardcore: me.isHardcore, gold: me.gold });
        // Save character to localStorage
        try {
          localStorage.setItem("mmo_character", JSON.stringify({
            name: me.name, playerClass: me.playerClass,
            level: me.level, xp: me.xp, savedAt: Date.now(),
            isHardcore: me.isHardcore,
            gold: me.gold,
            inventory: me.inventory,
            equipment: {
              weapon: me.equipWeapon, helmet: me.equipHelmet,
              chest: me.equipChest, legs: me.equipLegs, boots: me.equipBoots,
            },
          }));
        } catch {}
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [connected, isMobile]);

  /* ── Render ─────────────────────────────────────────── */

  if (error) return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", background: "#1a1a2e", color: "#e74c3c", fontSize: 20, padding: 20, textAlign: "center" }}><div>⚠️ Connection Error</div><div style={{ fontSize: 14, color: "#aaa", marginTop: 10 }}>{error}</div><button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: "10px 24px", background: "#3498db", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer" }}>Retry</button></div>;
  if (!connected) return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", background: "#1a1a2e", color: "#fff", fontSize: 20 }}><div style={{ fontSize: 32, marginBottom: 16 }}>🌍</div><div>Connecting...</div><div style={{ fontSize: 12, color: "#666", marginTop: 10 }}>If this takes too long, try refreshing</div></div>;

  const btnStyle: React.CSSProperties = {
    width: 60, height: 60, borderRadius: 12,
    border: "2px solid rgba(255,255,255,0.3)", background: "rgba(0,0,0,0.4)",
    color: "#fff", fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center",
    userSelect: "none", WebkitUserSelect: "none" as any, touchAction: "none",
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} tabIndex={0} onClick={handleCanvasClick} />

      {/* Death overlay */}
      {myStats && myStats.hp <= 0 && (
        <div style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          background: myStats.isHardcore ? "rgba(0,0,0,0.7)" : "rgba(139,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", zIndex: 15,
        }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>{myStats.isHardcore ? "☠️" : "💀"}</div>
          <div style={{ color: myStats.isHardcore ? "#ff4444" : "#fff", fontSize: 24, fontWeight: "bold", textShadow: "2px 2px 4px rgba(0,0,0,0.8)" }}>
            {myStats.isHardcore ? "HARDCORE DEATH" : "YOU DIED"}
          </div>
          {myStats.isHardcore ? (
            <>
              <div style={{ color: "#ccc", fontSize: 14, marginTop: 8, textAlign: "center" }}>Your character has been permanently lost.</div>
              <button
                onClick={() => {
                  localStorage.removeItem("mmo_character");
                  window.location.reload();
                }}
                style={{
                  marginTop: 20, padding: "12px 36px", background: "#333", color: "#fff",
                  border: "2px solid #666", borderRadius: 8, fontSize: 18, fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                Create New Character
              </button>
            </>
          ) : (
            <button
              onClick={() => roomRef.current?.send("request_respawn")}
              style={{
                marginTop: 20, padding: "12px 36px", background: "#c0392b", color: "#fff",
                border: "2px solid #e74c3c", borderRadius: 8, fontSize: 18, fontWeight: "bold",
                cursor: "pointer", textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#e74c3c")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#c0392b")}
            >
              ⛪ Respawn at Temple
            </button>
          )}
        </div>
      )}


      {chatOpen && (
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 20 }}>
          <input ref={chatInputRef} value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={100} placeholder="Type a message..."
            style={{ width: Math.min(400, window.innerWidth - 40), padding: "10px 16px", borderRadius: 8, border: "2px solid rgba(255,255,255,0.3)", background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: 14, outline: "none" }} />
        </div>
      )}

      {/* Mobile HUD — Top Bar */}
      {isMobile && myStats && (
        <div style={{ position: "absolute", top: 8, left: 8, right: 8, background: "rgba(0,0,0,0.7)", borderRadius: 8, padding: "8px 12px", zIndex: 10, color: "#fff", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span>{myStats.playerClass === "ranger" ? "🏹" : "⚔️"} Lv.{myStats.level}</span>
            <span>❤️ {myStats.hp}/{myStats.maxHp}</span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ color: "#f1c40f", fontWeight: "bold", fontSize: 13 }}>💰 {myStats.gold}</span>
            <div style={{ ...btnStyle, width: 40, height: 40, fontSize: 16, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); setInventoryOpen(prev => !prev); }}>🎒</div>
            <div style={{ ...btnStyle, width: 40, height: 40, fontSize: 16, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); setQuestLogOpen(prev => !prev); }}>📜</div>
          </div>
        </div>
      )}

      {isMobile && (
        <>
          {/* D-pad (bottom-left) */}
          <div style={{ position: "absolute", bottom: 16, left: 12, display: "grid", gridTemplateColumns: "48px 48px 48px", gridTemplateRows: "48px 48px 48px", gap: 3, zIndex: 10 }}>
            <div /><div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(0, -1, true); }} onTouchEnd={() => handleDpad(0, -1, false)} onTouchCancel={() => handleDpad(0, -1, false)}>▲</div><div />
            <div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(-1, 0, true); }} onTouchEnd={() => handleDpad(-1, 0, false)} onTouchCancel={() => handleDpad(-1, 0, false)}>◀</div>
            <div style={{ width: 48, height: 48 }} />
            <div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(1, 0, true); }} onTouchEnd={() => handleDpad(1, 0, false)} onTouchCancel={() => handleDpad(1, 0, false)}>▶</div>
            <div /><div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(0, 1, true); }} onTouchEnd={() => handleDpad(0, 1, false)} onTouchCancel={() => handleDpad(0, 1, false)}>▼</div><div />
          </div>

          {/* Spell bar (bottom center) */}
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, zIndex: 10 }}>
            <div style={{ ...btnStyle, background: "rgba(46,204,113,0.5)", fontSize: 14, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); roomRef.current?.send("heal"); }}>💚</div>
            <div style={{ ...btnStyle, background: "rgba(243,156,18,0.5)", fontSize: 14, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); const m = playersRef.current.get(sessionIdRef.current); roomRef.current?.send(m?.playerClass === "ranger" ? "power_shot" : "cleave"); }}>⚡</div>
            <div style={{ ...btnStyle, background: "rgba(231,76,60,0.4)", fontSize: 14, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); const now = Date.now(); if (now - lastPotionUse.current >= POTION_COOLDOWN_MS) { roomRef.current?.send("use_potion", { itemId: "health_potion" }); lastPotionUse.current = now; } }}>❤️</div>
            <div style={{ ...btnStyle, background: "rgba(52,152,219,0.4)", fontSize: 14, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); const now = Date.now(); if (now - lastPotionUse.current >= POTION_COOLDOWN_MS) { roomRef.current?.send("use_potion", { itemId: "mana_potion" }); lastPotionUse.current = now; } }}>💙</div>
          </div>

          {/* Quick actions (bottom-right) */}
          <div style={{ position: "absolute", bottom: 16, right: 12, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
            <div style={{ ...btnStyle, background: myStats?.targetId ? "rgba(231,76,60,0.6)" : "rgba(0,0,0,0.3)", fontSize: 14, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); sendClearTarget(); }}>🚫</div>
            <div style={{ ...btnStyle, fontSize: 14, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); talkToNearbyNPC(); }}>💬</div>
            <div style={{ ...btnStyle, fontSize: 14, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }} onTouchStart={(e) => { e.preventDefault(); setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 50); }}>✏️</div>
          </div>
        </>
      )}

      {/* Inventory overlay */}
      {inventoryOpen && (() => {
        const me = playersRef.current.get(sessionIdRef.current);
        if (!me) return null;
        const GRID_COLS = 5;
        const GRID_ROWS = 4;
        const SLOT_PX = 56;
        const slots: Array<{ itemId: string; quantity: number } | null> = [];
        for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
          slots.push(me.inventory[i] && me.inventory[i].quantity > 0 ? me.inventory[i] : null);
        }
        const equipSlots: Array<{ slot: EquipSlot; label: string; icon: string; itemId: string }> = [
          { slot: "weapon", label: "Weapon", icon: "⚔️", itemId: me.equipWeapon },
          { slot: "helmet", label: "Head", icon: "🪖", itemId: me.equipHelmet },
          { slot: "chest", label: "Chest", icon: "🦺", itemId: me.equipChest },
          { slot: "legs", label: "Legs", icon: "👖", itemId: me.equipLegs },
          { slot: "boots", label: "Feet", icon: "👡", itemId: me.equipBoots },
        ];
        return (
          <div style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
            background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 30,
          }} onClick={() => setInventoryOpen(false)}>
            <div style={{
              background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
              border: "2px solid #8b5cf6", borderRadius: 12, padding: 20,
              minWidth: 420, maxWidth: 500,
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h2 style={{ color: "#c4b5fd", margin: 0, fontSize: 18 }}>🎒 Inventory</h2>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: "#f1c40f", fontSize: 13 }}>💰 {me.gold}g</span>
                  {me.defense > 0 && <span style={{ color: "#7ec8e3", fontSize: 11, marginLeft: 10 }}>🛡️ {me.defense} DEF</span>}
                </div>
              </div>

              {/* Equipment slots */}
              <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
                {equipSlots.map((es) => {
                  const equipped = es.itemId ? ITEMS[es.itemId] : null;
                  return (
                    <div key={es.slot} style={{
                      width: SLOT_PX + 16, padding: "4px", borderRadius: 6,
                      background: equipped ? "rgba(46,204,113,0.15)" : "rgba(255,255,255,0.04)",
                      border: equipped ? "1px solid rgba(46,204,113,0.4)" : "1px dashed rgba(255,255,255,0.15)",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      cursor: equipped ? "pointer" : "default", minHeight: SLOT_PX,
                    }}
                    title={equipped ? `${equipped.name} — click to unequip` : es.label}
                    onClick={() => { if (equipped) { roomRef.current?.send("unequip_item", { slot: es.slot }); sfxEquip(); } }}
                    >
                      <span style={{ fontSize: 20 }}>{equipped ? equipped.icon : es.icon}</span>
                      <span style={{ fontSize: 8, color: equipped ? "#2ecc71" : "#555", marginTop: 2 }}>{es.label}</span>
                      {equipped && (
                        <span style={{ fontSize: 8, color: "#aaa", marginTop: 1 }}>{equipped.name.split(" ")[0]}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Inventory grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_COLS}, ${SLOT_PX}px)`,
                gap: 4,
              }}>
                {slots.map((slot, i) => {
                  const item = slot ? ITEMS[slot.itemId] : null;
                  const isEquippable = item?.equipSlot;
                  return (
                    <div key={i} style={{
                      width: SLOT_PX, height: SLOT_PX, borderRadius: 6,
                      background: slot ? (isEquippable ? "rgba(46,204,113,0.1)" : "rgba(139,92,246,0.15)") : "rgba(255,255,255,0.04)",
                      border: slot ? (isEquippable ? "1px solid rgba(46,204,113,0.3)" : "1px solid rgba(139,92,246,0.4)") : "1px solid rgba(255,255,255,0.08)",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      position: "relative", cursor: slot ? "pointer" : "default",
                      transition: "background 0.15s",
                    }}
                    title={item ? (isEquippable ? `${item.name} — click to equip` : item.name) : ""}
                    onClick={() => {
                      if (slot && item) {
                        if (item.equipSlot) {
                          roomRef.current?.send("equip_item", { itemId: slot.itemId });
                          sfxEquip();
                        } else if (item.effect) {
                          roomRef.current?.send("use_potion", { itemId: slot.itemId });
                        }
                      }
                    }}
                    onMouseOver={(e) => { if (slot) e.currentTarget.style.background = isEquippable ? "rgba(46,204,113,0.25)" : "rgba(139,92,246,0.3)"; }}
                    onMouseOut={(e) => { if (slot) e.currentTarget.style.background = isEquippable ? "rgba(46,204,113,0.1)" : "rgba(139,92,246,0.15)"; }}
                    >
                      {item && (
                        <>
                          <span style={{ fontSize: 22 }}>{item.icon}</span>
                          <span style={{ fontSize: 9, color: "#ccc", marginTop: 2 }}>{item.name.split(" ")[0]}</span>
                          {slot!.quantity > 1 && (
                            <span style={{
                              position: "absolute", bottom: 2, right: 4,
                              fontSize: 10, fontWeight: "bold", color: "#f1c40f",
                              textShadow: "0 0 3px rgba(0,0,0,0.8)",
                            }}>×{slot!.quantity}</span>
                          )}
                          {isEquippable && (
                            <span style={{
                              position: "absolute", top: 2, right: 4,
                              fontSize: 8, color: "#2ecc71",
                            }}>EQ</span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Use/equip hint */}
              <div style={{ marginTop: 8, color: "#64748b", fontSize: 10, textAlign: "center" }}>
                Click items to use/equip • Click equipped items to unequip
              </div>
              <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#64748b", fontSize: 11 }}>{me.inventory.filter(s => s.quantity > 0).length}/{GRID_COLS * GRID_ROWS} slots</span>
                <button onClick={() => setInventoryOpen(false)} style={{
                  padding: "5px 14px", borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                  color: "#94a3b8", cursor: "pointer", fontSize: 12,
                }}>Close (I)</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Shop overlay */}
      {shopOpen && myStats && (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 25 }} onClick={() => setShopOpen(false)}>
          <div style={{ background: "#1a1a2e", border: "2px solid #f1c40f", borderRadius: 12, padding: 24, minWidth: 280, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ color: "#f1c40f", margin: 0, fontSize: 20 }}>🏪 Pip&apos;s Shop</h2>
              <span style={{ color: "#f1c40f", fontSize: 14 }}>💰 {myStats.gold}</span>
            </div>
            {SHOP_ITEMS.map(itemId => {
              const item = ITEMS[itemId];
              if (!item) return null;
              const canAfford = myStats.gold >= item.buyPrice;
              return (
                <div key={itemId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, marginBottom: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{item.icon}</span>
                    <div>
                      <div style={{ color: "#fff", fontWeight: "bold", fontSize: 14 }}>{item.name}</div>
                      <div style={{ color: "#888", fontSize: 11 }}>{item.effect?.hp ? `+${item.effect.hp} HP` : item.effect?.mp ? `+${item.effect.mp} MP` : item.equipBonus ? [item.equipBonus.atk && `+${item.equipBonus.atk} ATK`, item.equipBonus.def && `+${item.equipBonus.def} DEF`, item.equipBonus.maxHp && `+${item.equipBonus.maxHp} HP`, item.equipBonus.maxMp && `+${item.equipBonus.maxMp} MP`].filter(Boolean).join(", ") : ""}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#f1c40f", fontSize: 13 }}>{item.buyPrice}g</span>
                    <button onClick={() => roomRef.current?.send("shop_buy", { itemId, quantity: 1 })} disabled={!canAfford} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: canAfford ? "#27ae60" : "#555", color: "#fff", cursor: canAfford ? "pointer" : "default", fontSize: 12, fontWeight: "bold" }}>×1</button>
                    <button onClick={() => roomRef.current?.send("shop_buy", { itemId, quantity: 10 })} disabled={myStats.gold < item.buyPrice * 10} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: myStats.gold >= item.buyPrice * 10 ? "#2980b9" : "#555", color: "#fff", cursor: myStats.gold >= item.buyPrice * 10 ? "pointer" : "default", fontSize: 12, fontWeight: "bold" }}>×10</button>
                  </div>
                </div>
              );
            })}
            <button onClick={() => setShopOpen(false)} style={{ marginTop: 12, width: "100%", padding: "8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#aaa", cursor: "pointer", fontSize: 14 }}>Close</button>
          </div>
        </div>
      )}

      {/* Quest Log overlay */}
      {questLogOpen && (() => {
        const quests = questTrackerRef.current;
        return (
          <div style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
            background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 30,
          }} onClick={() => setQuestLogOpen(false)}>
            <div style={{
              background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
              border: "2px solid #ffd700", borderRadius: 12, padding: 20,
              minWidth: 350, maxWidth: 450,
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h2 style={{ color: "#ffd700", margin: 0, fontSize: 18 }}>📜 Quest Log</h2>
                <span style={{ color: "#888", fontSize: 12 }}>{quests.length}/5 quests</span>
              </div>
              {quests.length === 0 ? (
                <div style={{ color: "#666", textAlign: "center", padding: "20px 0", fontSize: 14 }}>
                  No active quests. Talk to NPCs (press E) to find quests!
                </div>
              ) : (
                quests.map((q) => (
                  <div key={q.questId} style={{
                    padding: "10px 12px", borderRadius: 8, marginBottom: 8,
                    background: q.completed ? "rgba(46,204,113,0.15)" : "rgba(255,255,255,0.05)",
                    border: q.completed ? "1px solid rgba(46,204,113,0.4)" : "1px solid rgba(255,255,255,0.1)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: 16, marginRight: 6 }}>{q.icon}</span>
                        <span style={{ color: "#fff", fontWeight: "bold", fontSize: 14 }}>{q.name}</span>
                      </div>
                      {q.completed ? (
                        <span style={{ color: "#2ecc71", fontSize: 12, fontWeight: "bold" }}>✅ Complete</span>
                      ) : (
                        <span style={{ color: "#3498db", fontSize: 12 }}>{q.progress}/{q.required}</span>
                      )}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      {!q.completed && (
                        <div style={{ height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(q.progress / q.required) * 100}%`, background: "linear-gradient(90deg, #3498db, #2ecc71)", borderRadius: 3, transition: "width 0.3s" }} />
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                        <span style={{ color: "#888", fontSize: 11 }}>Kill {q.required} {q.killTarget}{q.required > 1 ? "s" : ""}</span>
                        <button onClick={() => {
                          roomRef.current?.send("quest_abandon", { questId: q.questId });
                          setQuestLogOpen(false);
                        }} style={{
                          padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(231,76,60,0.4)",
                          background: "transparent", color: "#e74c3c", cursor: "pointer", fontSize: 10,
                        }}>Abandon</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              <button onClick={() => setQuestLogOpen(false)} style={{
                marginTop: 8, width: "100%", padding: "8px", borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                color: "#94a3b8", cursor: "pointer", fontSize: 12,
              }}>Close (Q)</button>
            </div>
          </div>
        );
      })()}

      {/* NPC Quest Dialog */}
      {questDialogOpen && questDialogData && (
        <div style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 35,
        }} onClick={() => setQuestDialogOpen(false)}>
          <div style={{
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            border: "2px solid #ffd700", borderRadius: 12, padding: 20,
            minWidth: 360, maxWidth: 480,
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: "#ffd700", margin: "0 0 14px 0", fontSize: 18 }}>
              💬 {questDialogData.npcName}
            </h2>

            {/* Turn-in quests first */}
            {questDialogData.turnIn.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#2ecc71", fontSize: 12, fontWeight: "bold", marginBottom: 6 }}>Ready to Turn In:</div>
                {questDialogData.turnIn.map((q: any) => (
                  <div key={q.id} style={{
                    padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                    background: "rgba(46,204,113,0.15)", border: "1px solid rgba(46,204,113,0.4)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div>
                      <span style={{ fontSize: 16, marginRight: 6 }}>{q.icon}</span>
                      <span style={{ color: "#fff", fontWeight: "bold", fontSize: 14 }}>{q.name}</span>
                      <div style={{ color: "#aaa", fontSize: 11, marginTop: 4 }}>
                        Rewards: {q.rewards.xp} XP, {q.rewards.gold} gold
                        {q.rewards.items?.map((it: any) => `, ${ITEMS[it.itemId]?.icon || ""} ${ITEMS[it.itemId]?.name || it.itemId}`).join("")}
                      </div>
                    </div>
                    <button onClick={() => {
                      roomRef.current?.send("quest_turnin", { questId: q.id });
                      setQuestDialogOpen(false);
                    }} style={{
                      padding: "6px 14px", borderRadius: 6, border: "none",
                      background: "#27ae60", color: "#fff", cursor: "pointer",
                      fontSize: 13, fontWeight: "bold",
                    }}>Complete ✅</button>
                  </div>
                ))}
              </div>
            )}

            {/* Available quests */}
            {questDialogData.available.length > 0 && (
              <div>
                <div style={{ color: "#ffd700", fontSize: 12, fontWeight: "bold", marginBottom: 6 }}>Available Quests:</div>
                {questDialogData.available.map((q: any) => (
                  <div key={q.id} style={{
                    padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                    background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.3)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 16, marginRight: 6 }}>{q.icon}</span>
                        <span style={{ color: "#fff", fontWeight: "bold", fontSize: 14 }}>{q.name}</span>
                        {q.requiredLevel > 1 && <span style={{ color: "#888", fontSize: 10, marginLeft: 6 }}>Lv.{q.requiredLevel}+</span>}
                        <div style={{ color: "#aaa", fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{q.description}</div>
                        <div style={{ color: "#888", fontSize: 11, marginTop: 4 }}>
                          Kill {q.killCount} {q.killTarget}{q.killCount > 1 ? "s" : ""}
                        </div>
                        <div style={{ color: "#2ecc71", fontSize: 11, marginTop: 2 }}>
                          Rewards: {q.rewards.xp} XP, {q.rewards.gold} gold
                          {q.rewards.items?.map((it: any) => `, ${ITEMS[it.itemId]?.icon || ""} ${ITEMS[it.itemId]?.name || it.itemId}`).join("")}
                        </div>
                      </div>
                      <button onClick={() => {
                        roomRef.current?.send("quest_accept", { questId: q.id });
                        // Add to local tracker immediately
                        questTrackerRef.current.push({
                          questId: q.id, name: q.name, icon: q.icon,
                          progress: 0, required: q.killCount,
                          completed: false, killTarget: q.killTarget,
                        });
                        setQuestDialogOpen(false);
                      }} style={{
                        padding: "6px 14px", borderRadius: 6, border: "none",
                        background: "#f39c12", color: "#fff", cursor: "pointer",
                        fontSize: 13, fontWeight: "bold", marginLeft: 10, whiteSpace: "nowrap",
                      }}>Accept 📜</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={() => setQuestDialogOpen(false)} style={{
              marginTop: 10, width: "100%", padding: "8px", borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
              color: "#94a3b8", cursor: "pointer", fontSize: 12,
            }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
