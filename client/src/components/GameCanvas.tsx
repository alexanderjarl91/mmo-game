import { useEffect, useRef, useState, useCallback } from "react";
import { joinGame, sendMove, sendSetTarget, sendClearTarget } from "../lib/network";
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

// Tibia XP formula
function xpForLevel(level: number): number {
  return Math.floor((50 / 3) * (level * level * level - 6 * level * level + 17 * level - 12));
}

interface Projectile { fromX: number; fromY: number; toX: number; toY: number; time: number; }

interface Props { playerName: string; playerClass: string; }

export default function GameCanvas({ playerName, playerClass }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<Room | null>(null);
  const playersRef = useRef<Map<string, PlayerData>>(new Map());
  const slimesRef = useRef<Map<string, SlimeData>>(new Map());
  const wolvesRef = useRef<Map<string, WolfData>>(new Map());
  const sessionIdRef = useRef("");
  const keysRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [myStats, setMyStats] = useState<{ hp: number; maxHp: number; xp: number; level: number; playerClass: string; targetId: string } | null>(null);
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
          case TILE.WATER:
            ctx.fillStyle = "rgba(30,100,200,0.75)"; ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.strokeStyle = "rgba(100,180,255,0.4)"; ctx.lineWidth = 1;
            for (let r = 0; r < 3; r++) { const ry = py + 15 + r * 16; ctx.beginPath(); ctx.moveTo(px + 8, ry); ctx.quadraticCurveTo(px + 32, ry - 5 + (r % 2) * 10, px + 56, ry); ctx.stroke(); }
            break;
          case TILE.TREE:
            ctx.fillStyle = "#5D4037"; ctx.fillRect(px + 24, py + 32, 16, 28);
            ctx.fillStyle = "rgba(0,80,0,0.9)"; ctx.beginPath(); ctx.arc(px + 32, py + 24, 22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(50,160,50,0.8)"; ctx.beginPath(); ctx.arc(px + 30, py + 20, 18, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(100,200,80,0.5)"; ctx.beginPath(); ctx.arc(px + 26, py + 16, 8, 0, Math.PI * 2); ctx.fill();
            break;
          case TILE.ROCK:
            ctx.fillStyle = "#757575"; ctx.beginPath(); ctx.ellipse(px + 32, py + 38, 24, 18, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#9E9E9E"; ctx.beginPath(); ctx.ellipse(px + 28, py + 34, 18, 14, -0.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#BDBDBD"; ctx.beginPath(); ctx.ellipse(px + 26, py + 32, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
            break;
          case TILE.FLOWERS: {
            const fc = ["#FF5252", "#FFEB3B", "#E040FB", "#FF6D00", "#69F0AE"];
            for (let f = 0; f < 6; f++) {
              const fx = px + 10 + ((f * 17) % 44), fy = py + 10 + ((f * 23) % 44);
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

    joinGame(playerName, playerClass).then((room) => {
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
          });
        }
        const wolf = wolvesRef.current.get(data.targetId);
        if (wolf) {
          wolf.hitTime = performance.now();
          damageNumbersRef.current.push({
            x: wolf.displayX + TILE_SIZE / 2,
            y: wolf.displayY,
            damage: data.damage,
            time: performance.now(),
          });
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
      });

      room.onMessage("kill", (data: { killerName: string; xp: number; targetId?: string }) => {
        const isWolf = data.targetId?.startsWith("wolf_");
        killFeedRef.current.push({ text: `${data.killerName} slayed a ${isWolf ? "wolf" : "slime"}! (+${data.xp} XP)`, time: performance.now() });
        if (killFeedRef.current.length > 5) killFeedRef.current.shift();
      });

      room.onMessage("levelup", (data: { name: string; level: number }) => {
        killFeedRef.current.push({ text: `⭐ ${data.name} reached level ${data.level}!`, time: performance.now() });
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
      });

      room.onMessage("pvp_kill", (data: { killerName: string; targetName: string; xp: number }) => {
        killFeedRef.current.push({ text: `☠️ ${data.killerName} killed ${data.targetName}! (+${data.xp} XP)`, time: performance.now() });
      });

      room.onMessage("projectile", (data: { fromX: number; fromY: number; toX: number; toY: number }) => {
        projectilesRef.current.push({ ...data, time: performance.now() });
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
        };
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

      room.onLeave(() => { if (!cancelled) setConnected(false); });
    }).catch((err) => { if (!cancelled) setError(err.message || "Failed to connect"); });

    return () => { cancelled = true; roomRef.current?.leave(); };
  }, [playerName, buildTileCache]);

  /* ── Input ──────────────────────────────────────────── */

  // Click-to-target handler
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
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

    // Check players
    playersRef.current.forEach((p, sid) => {
      if (sid === sessionIdRef.current || p.hp <= 0) return;
      const px = p.displayX + TILE_SIZE / 2;
      const py = p.displayY + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - px) ** 2 + (worldY - py) ** 2);
      if (d < TILE_SIZE && d < bestDist) { bestId = sid; bestDist = d; }
    });

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
    if (closest) roomRef.current?.send("npc_talk", { npcId: closest.id });
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (chatOpen) {
          if (chatText.trim()) { roomRef.current?.send("chat", { message: chatText }); setChatText(""); }
          setChatOpen(false); canvasRef.current?.focus(); return;
        } else { e.preventDefault(); setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 50); return; }
      }
      if (e.key === "Escape" && chatOpen) { setChatOpen(false); setChatText(""); canvasRef.current?.focus(); return; }
      if (chatOpen) return;
      if (e.key === "Escape" && !chatOpen) { sendClearTarget(); return; }
      if (e.key === "e" || e.key === "E") { talkToNearbyNPC(); return; }
      if (e.key === "1") { roomRef.current?.send("heal"); return; }
      if (e.key === "2") {
        const me = playersRef.current.get(sessionIdRef.current);
        if (me?.playerClass === "ranger") roomRef.current?.send("power_shot");
        else roomRef.current?.send("cleave");
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
  }, [chatOpen, chatText, talkToNearbyNPC]);

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

      // Clean up timed effects
      chatBubblesRef.current = chatBubblesRef.current.filter(b => now - b.time < CHAT_DURATION);
      emoteBubblesRef.current = emoteBubblesRef.current.filter(b => now - b.time < EMOTE_DURATION);
      damageNumbersRef.current = damageNumbersRef.current.filter(d => now - d.time < DAMAGE_DURATION);
      killFeedRef.current = killFeedRef.current.filter(k => now - k.time < 5000);
      projectilesRef.current = projectilesRef.current.filter(p => now - p.time < 400);
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
      const camX = me ? me.displayX + TILE_SIZE / 2 - w / 2 : 0;
      const camY = me ? me.displayY + TILE_SIZE / 2 - h / 2 : 0;

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

        // Name above HP bar
        const nameStr = p.level > 1 ? `${p.name} [${p.level}]` : p.name;
        ctx.font = "bold 12px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText(nameStr, px + 1, py - 41);
        ctx.fillStyle = "#fff"; ctx.fillText(nameStr, px, py - 42);

        // HP bar below name
        drawHPBar(ctx, px, py - 34, p.hp, p.maxHp, 40);

        // MP bar (only for local player)
        if (sid === sessionIdRef.current) {
          const mpW = 40;
          const mpY = py - 26;
          ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(px - mpW / 2 - 1, mpY - 1, mpW + 2, 5);
          ctx.fillStyle = "#1a1a2e"; ctx.fillRect(px - mpW / 2, mpY, mpW, 3);
          const mpRatio = p.maxMp > 0 ? p.mp / p.maxMp : 0;
          ctx.fillStyle = "#3498db"; ctx.fillRect(px - mpW / 2, mpY, mpW * mpRatio, 3);
        }

        // Dead overlay
        if (p.hp <= 0) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.font = "24px serif";
          ctx.textAlign = "center";
          ctx.fillText("💀", px, py + 5);
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
        const floatY = dmg.y - camY - progress * 40;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = "bold 18px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = dmg.color || "#e74c3c";
        ctx.fillText(`${dmg.prefix || "-"}${dmg.damage}`, dmg.x - camX, floatY);
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

      /* ── HUD ─────────────────────────────────────────── */

      ctx.font = "12px monospace"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.textAlign = "left";
      ctx.fillText(`Players: ${playersRef.current.size}`, 10, 20);
      if (me) {
        ctx.fillText(`Tile: ${Math.round(me.toX / TILE_SIZE)}, ${Math.round(me.toY / TILE_SIZE)}`, 10, 36);

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

        }

        // ── Spell bar (centered bottom) ────────────────
        const SLOT_SIZE = 52;
        const SLOT_GAP = 6;
        const SLOT_COUNT = 4;
        const barW = SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
        const barX = Math.floor(w / 2 - barW / 2);
        const barBY = h - SLOT_SIZE - 12;

        const isRanger = me.playerClass === "ranger";
        const ATTACK_SPELL_COST = 30;
        const spells = [
          { key: "1", icon: "💚", name: "Heal", cost: HEAL_COST, active: true, canUse: me.mp >= HEAL_COST && me.hp < me.maxHp },
          { key: "2", icon: isRanger ? "🏹" : "⚔️", name: isRanger ? "P.Shot" : "Cleave", cost: ATTACK_SPELL_COST, active: true, canUse: me.mp >= ATTACK_SPELL_COST && (isRanger ? !!me.targetId : true) },
          { key: "3", icon: "", name: "", cost: 0, active: false, canUse: false },
          { key: "4", icon: "", name: "", cost: 0, active: false, canUse: false },
        ];

        for (let i = 0; i < spells.length; i++) {
          const spell = spells[i];
          const sx = barX + i * (SLOT_SIZE + SLOT_GAP);

          // Slot background
          ctx.fillStyle = spell.active ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.4)";
          ctx.beginPath();
          ctx.roundRect(sx, barBY, SLOT_SIZE, SLOT_SIZE, 6);
          ctx.fill();

          // Border
          ctx.strokeStyle = spell.canUse ? "rgba(46,204,113,0.8)" : spell.active ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(sx, barBY, SLOT_SIZE, SLOT_SIZE, 6);
          ctx.stroke();

          // Icon
          if (spell.icon) {
            ctx.font = "22px serif";
            ctx.textAlign = "center";
            ctx.globalAlpha = spell.canUse ? 1 : 0.4;
            ctx.fillText(spell.icon, sx + SLOT_SIZE / 2, barBY + 28);
            ctx.globalAlpha = 1;
          } else {
            // Empty slot
            ctx.font = "18px serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(255,255,255,0.1)";
            ctx.fillText("—", sx + SLOT_SIZE / 2, barBY + 28);
          }

          // Mana cost
          if (spell.active && spell.cost > 0) {
            ctx.font = "9px 'Segoe UI', sans-serif";
            ctx.fillStyle = spell.canUse ? "#7ec8e3" : "rgba(126,200,227,0.4)";
            ctx.textAlign = "center";
            ctx.fillText(`${spell.cost} MP`, sx + SLOT_SIZE / 2, barBY + SLOT_SIZE - 5);
          }

          // Key number
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.textAlign = "left";
          ctx.fillText(spell.key, sx + 4, barBY + 12);
        }
      }

      if (!isMobile) {
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "12px monospace"; ctx.textAlign = "right";
        ctx.fillText("WASD: Move | Click: Target | E: Talk | 1: Heal | Enter: Chat | Esc: Untarget", w - 10, 20);
      }

      // Update React state for HUD overlay (throttled)
      if (me && Math.floor(time / 500) !== Math.floor((time - 16) / 500)) {
        setMyStats({ hp: me.hp, maxHp: me.maxHp, xp: me.xp, level: me.level, playerClass: me.playerClass, targetId: me.targetId });
        // Save character to localStorage
        try {
          localStorage.setItem("mmo_character", JSON.stringify({
            name: me.name, playerClass: me.playerClass,
            level: me.level, xp: me.xp, savedAt: Date.now(),
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
          background: "rgba(139,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", zIndex: 15,
        }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>💀</div>
          <div style={{ color: "#fff", fontSize: 24, fontWeight: "bold", textShadow: "2px 2px 4px rgba(0,0,0,0.8)" }}>YOU DIED</div>
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
        </div>
      )}

      {chatOpen && (
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 20 }}>
          <input ref={chatInputRef} value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={100} placeholder="Type a message..."
            style={{ width: Math.min(400, window.innerWidth - 40), padding: "10px 16px", borderRadius: 8, border: "2px solid rgba(255,255,255,0.3)", background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: 14, outline: "none" }} />
        </div>
      )}

      {/* Mobile stats overlay */}
      {isMobile && myStats && (
        <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "6px 10px", zIndex: 10, color: "#fff", fontSize: 11 }}>
          <div>{myStats.playerClass === "ranger" ? "🏹" : "⚔️"} Lv.{myStats.level} | HP: {myStats.hp}/{myStats.maxHp} | XP: {myStats.xp - xpForLevel(myStats.level)}/{xpForLevel(myStats.level + 1) - xpForLevel(myStats.level)}</div>
        </div>
      )}

      {isMobile && (
        <>
          <div style={{ position: "absolute", bottom: 30, left: 30, display: "grid", gridTemplateColumns: "60px 60px 60px", gridTemplateRows: "60px 60px 60px", gap: 6, zIndex: 10 }}>
            <div /><div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(0, -1, true); }} onTouchEnd={() => handleDpad(0, -1, false)} onTouchCancel={() => handleDpad(0, -1, false)}>▲</div><div />
            <div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(-1, 0, true); }} onTouchEnd={() => handleDpad(-1, 0, false)} onTouchCancel={() => handleDpad(-1, 0, false)}>◀</div>
            <div style={{ width: 60, height: 60 }} />
            <div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(1, 0, true); }} onTouchEnd={() => handleDpad(1, 0, false)} onTouchCancel={() => handleDpad(1, 0, false)}>▶</div>
            <div /><div style={btnStyle} onTouchStart={(e) => { e.preventDefault(); handleDpad(0, 1, true); }} onTouchEnd={() => handleDpad(0, 1, false)} onTouchCancel={() => handleDpad(0, 1, false)}>▼</div><div />
          </div>

          <div style={{ position: "absolute", bottom: 30, right: 30, display: "flex", flexDirection: "column", gap: 10, zIndex: 10 }}>
            <div style={{ ...btnStyle, background: myStats?.targetId ? "rgba(231,76,60,0.6)" : "rgba(0,0,0,0.4)", fontSize: 14, width: 60, height: 60 }}
              onTouchStart={(e) => { e.preventDefault(); sendClearTarget(); }}>🚫</div>
            <div style={{ ...btnStyle, background: "rgba(46,204,113,0.5)", fontSize: 14, width: 56, height: 56 }}
              onTouchStart={(e) => { e.preventDefault(); roomRef.current?.send("heal"); }}>💚</div>
            <div style={{ ...btnStyle, background: "rgba(243,156,18,0.5)", fontSize: 14, width: 56, height: 56 }}
              onTouchStart={(e) => { e.preventDefault(); const me = playersRef.current.get(sessionIdRef.current); roomRef.current?.send(me?.playerClass === "ranger" ? "power_shot" : "cleave"); }}>⚡</div>
            <div style={{ ...btnStyle, fontSize: 14, width: 56, height: 56 }}
              onTouchStart={(e) => { e.preventDefault(); talkToNearbyNPC(); }}>💬</div>
            <div style={{ ...btnStyle, fontSize: 14, width: 56, height: 56 }}
              onTouchStart={(e) => { e.preventDefault(); setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 50); }}>✏️</div>
          </div>
        </>
      )}
    </div>
  );
}
