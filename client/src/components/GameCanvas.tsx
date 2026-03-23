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
interface DamageNumber { x: number; y: number; damage: number; time: number; }
interface KillFeed { text: string; time: number; }

/* ── Constants ─────────────────────────────────────── */

const TILE_SIZE = 64;
const MOVE_DURATION = 110;
const KEY_REPEAT_MS = 120;
const CHAT_DURATION = 4000;
const EMOTE_DURATION = 2000;
const NPC_DIALOGUE_DURATION = 5000;
const DAMAGE_DURATION = 1200;

const SPRITE_SZ = 32; // DCSS sprites are 32x32, rendered at TILE_SIZE (64)
const TILE = { GRASS: 0, PATH: 1, WATER: 2, TREE: 3, ROCK: 4, FLOWERS: 5, BRIDGE: 6, WALL: 7, FLOOR: 8 };
const EMOTES = ["👋", "😂", "❤️", "⚔️", "🎉"];

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

  const spritesRef = useRef<Record<string, HTMLImageElement>>({});
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
    const spriteNames = [
      "grass", "grass_flowers", "dirt", "cobble", "path", "stone_floor",
      "water", "shallow_water", "tree", "wall", "stone_wall", "rock", "door",
      "warrior", "ranger", "wolf",
      "slime_green", "slime_blue", "slime_red", "slime_purple", "slime_big",
      "npc_dwarf", "npc_elf", "npc_sage", "npc_halfling",
    ];
    Promise.all(spriteNames.map(n => load(`/assets/dcss/${n}.png`))).then((imgs) => {
      imgs.forEach((img, i) => {
        if (img.complete && img.naturalWidth) spritesRef.current[spriteNames[i]] = img;
      });
      buildTileCache();
    });
  }, []);

  const spr = (name: string): HTMLImageElement | null => spritesRef.current[name] || null;

  /* ── Tile cache ─────────────────────────────────────── */

  const buildTileCache = useCallback(() => {
    const map = worldMapRef.current;
    if (!map) return;
    const s = spritesRef.current;
    if (!s.grass) return; // sprites not loaded yet
    const mw = mapSizeRef.current.w, mh = mapSizeRef.current.h;
    const c = document.createElement("canvas");
    c.width = mw * TILE_SIZE; c.height = mh * TILE_SIZE;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false; // crisp pixel art

    const drawSpr = (img: HTMLImageElement | undefined, px: number, py: number) => {
      if (img) ctx.drawImage(img, 0, 0, SPRITE_SZ, SPRITE_SZ, px, py, TILE_SIZE, TILE_SIZE);
    };

    const tileSprite: Record<number, string> = {
      [TILE.GRASS]: "grass",
      [TILE.PATH]: "path",
      [TILE.WATER]: "water",
      [TILE.TREE]: "tree",
      [TILE.ROCK]: "rock",
      [TILE.FLOWERS]: "grass_flowers",
      [TILE.BRIDGE]: "cobble",
      [TILE.WALL]: "wall",
      [TILE.FLOOR]: "stone_floor",
    };

    for (let ty = 0; ty < mh; ty++) {
      for (let tx = 0; tx < mw; tx++) {
        const px = tx * TILE_SIZE, py = ty * TILE_SIZE;
        const tile = map[ty]?.[tx] ?? 0;

        // Base: always draw grass underneath
        const variant = ((tx * 7 + ty * 13) & 3) === 0;
        drawSpr(variant ? (s.dirt || s.grass) : s.grass, px, py);

        // Overlay tile sprite
        if (tile !== TILE.GRASS) {
          const name = tileSprite[tile];
          if (name && s[name]) {
            if (tile === TILE.WATER || tile === TILE.TREE || tile === TILE.ROCK || tile === TILE.WALL) {
              // These fully replace grass
              drawSpr(s[name], px, py);
            } else {
              // These overlay on grass (path, flowers, floor, bridge)
              drawSpr(s[name], px, py);
            }
          }
        }
      }
    }
    // Map border
    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 2;
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
      sendSetTarget(bestId);
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
      ctx.imageSmoothingEnabled = false; // crisp pixel art scaling

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

      const SLIME_SPRITES: Record<string, string> = {
        "#2ecc71": "slime_green", "#3498db": "slime_blue",
        "#e74c3c": "slime_red", "#9b59b6": "slime_purple",
      };

      slimesRef.current.forEach((s, slimeId) => {
        if (!s.alive) return;
        const sx = s.displayX - camX;
        const sy = s.displayY - camY;
        if (sx < -80 || sx > w + 80 || sy < -80 || sy > h + 80) return;

        const isTargeted = myTargetId === slimeId;
        const sizeScale = s.size === "small" ? 0.7 : s.size === "big" ? 1.3 : 1.0;
        const isHit = s.hitTime > 0 && now - s.hitTime < 200;
        const bounce = Math.sin(time / 400) * 2;
        const drawSize = TILE_SIZE * sizeScale;
        const ox = sx + (TILE_SIZE - drawSize) / 2;
        const oy = sy + (TILE_SIZE - drawSize) / 2 + bounce;

        // Target highlight
        if (isTargeted) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(ox - 2, oy - 2, drawSize + 4, drawSize + 4);
        }

        // Draw slime sprite
        ctx.save();
        if (isHit) ctx.globalAlpha = 0.5 + Math.sin(now * 0.05) * 0.5;
        const spriteName = s.size === "big" ? "slime_big" : (SLIME_SPRITES[s.color] || "slime_green");
        const img = spr(spriteName);
        if (img) {
          ctx.drawImage(img, 0, 0, SPRITE_SZ, SPRITE_SZ, ox, oy, drawSize, drawSize);
        }
        ctx.restore();

        // HP bar
        if (s.hp < s.maxHp || isTargeted) {
          drawHPBar(ctx, sx + TILE_SIZE / 2, sy - 4 + bounce, s.hp, s.maxHp, 36 * sizeScale);
        }
      });

      /* ── Wolves ─────────────────────────────────────── */

      wolvesRef.current.forEach((wolf, wolfId) => {
        if (!wolf.alive) return;
        const wx = wolf.displayX - camX;
        const wy = wolf.displayY - camY;
        if (wx < -80 || wx > w + 80 || wy < -80 || wy > h + 80) return;

        const isWolfTargeted = myTargetId === wolfId;
        const wolfHitFlash = wolf.hitTime && (now - wolf.hitTime < 200);

        // Target highlight
        if (isWolfTargeted) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(wx - 2, wy - 2, TILE_SIZE + 4, TILE_SIZE + 4);
        }

        // Draw wolf sprite
        ctx.save();
        if (wolfHitFlash) ctx.globalAlpha = 0.5 + Math.sin(now * 0.05) * 0.5;
        const wolfImg = spr("wolf");
        if (wolfImg) {
          ctx.drawImage(wolfImg, 0, 0, SPRITE_SZ, SPRITE_SZ, wx, wy, TILE_SIZE, TILE_SIZE);
        }
        ctx.restore();

        // Name
        const cx = wx + TILE_SIZE / 2;
        ctx.font = "bold 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText("Wolf", cx + 1, wy - 5);
        ctx.fillStyle = "#ff6b6b"; ctx.fillText("Wolf", cx, wy - 6);

        // HP bar
        if (wolf.hp < wolf.maxHp || isWolfTargeted) {
          drawHPBar(ctx, cx, wy - 12, wolf.hp, wolf.maxHp, 40);
        }
      });

      /* ── NPCs ────────────────────────────────────────── */

      const NPC_SPRITES: Record<string, string> = {
        "Elder Oak": "npc_sage", "Mira": "npc_elf", "Forge": "npc_dwarf",
        "Pip": "npc_halfling", "Old Gil": "npc_elf",
      };

      for (const npc of npcsRef.current) {
        const nx = npc.x * TILE_SIZE - camX;
        const ny = npc.y * TILE_SIZE - camY;
        if (nx < -80 || nx > w + 80 || ny < -80 || ny > h + 80) continue;

        const npcImg = spr(NPC_SPRITES[npc.name] || "npc_elf");
        if (npcImg) {
          ctx.drawImage(npcImg, 0, 0, SPRITE_SZ, SPRITE_SZ, nx, ny, TILE_SIZE, TILE_SIZE);
        }

        const cx = nx + TILE_SIZE / 2;
        ctx.font = "bold 13px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText(npc.name, cx + 1, ny - 5);
        ctx.fillStyle = "#FFD700"; ctx.fillText(npc.name, cx, ny - 6);

        if (me) {
          const dist = Math.abs(Math.round(me.toX / TILE_SIZE) - npc.x) + Math.abs(Math.round(me.toY / TILE_SIZE) - npc.y);
          if (dist <= 2) { ctx.font = "10px 'Segoe UI', sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillText("[E] Talk", cx, ny - 18); }
        }
      }

      /* ── Players ─────────────────────────────────────── */

      playersRef.current.forEach((p, sid) => {
        const px = p.displayX - camX;
        const py = p.displayY - camY;
        const cx = px + TILE_SIZE / 2;
        if (px < -80 || px > w + 80 || py < -80 || py > h + 80) return;

        // PvP target highlight
        if (sid !== sessionIdRef.current && myTargetId === sid) {
          const pulse = 0.5 + Math.sin(time / 200) * 0.3;
          ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(px - 2, py - 2, TILE_SIZE + 4, TILE_SIZE + 4);
        }

        // Draw player sprite
        const spriteName = p.playerClass === "ranger" ? "ranger" : "warrior";
        const playerImg = spr(spriteName);
        if (playerImg) {
          ctx.save();
          if (p.hp <= 0) ctx.globalAlpha = 0.4;
          ctx.drawImage(playerImg, 0, 0, SPRITE_SZ, SPRITE_SZ, px, py, TILE_SIZE, TILE_SIZE);
          ctx.restore();
        } else {
          ctx.beginPath(); ctx.arc(cx, py + TILE_SIZE / 2, 20, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
        }

        // Self indicator (subtle white border)
        if (sid === sessionIdRef.current) {
          ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        const classIcon = p.playerClass === "ranger" ? "🏹" : "⚔️";
        const nameStr = `${classIcon} ${p.name}`;
        ctx.font = "bold 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText(nameStr, cx + 1, py - 5);
        ctx.fillStyle = "#fff"; ctx.fillText(nameStr, cx, py - 6);

        // Level badge
        if (p.level > 1) {
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#FFD700";
          ctx.fillText(`Lv.${p.level}`, cx, py - 16);
        }

        // HP bar
        drawHPBar(ctx, cx, py - 22, p.hp, p.maxHp, 40);

        // Dead overlay
        if (p.hp <= 0) {
          ctx.font = "24px serif"; ctx.textAlign = "center";
          ctx.fillText("💀", cx, py + TILE_SIZE / 2 + 8);
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
        ctx.fillStyle = "#e74c3c";
        ctx.fillText(`-${dmg.damage}`, dmg.x - camX, floatY);
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
          drawHPBar(ctx, 40, barY - 5, me.hp, me.maxHp, 120);
          ctx.font = "10px monospace"; ctx.fillStyle = "#ccc";
          ctx.fillText(`${me.hp}/${me.maxHp}`, 170, barY);

          // XP
          ctx.font = "bold 12px 'Segoe UI', sans-serif"; ctx.fillStyle = "#fff";
          ctx.fillText(`XP`, 10, barY + 18);
          const xpInLevel = me.xp % 100;
          ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(39, barY + 8, 122, 7);
          ctx.fillStyle = "#333"; ctx.fillRect(40, barY + 9, 120, 5);
          ctx.fillStyle = "#3498db"; ctx.fillRect(40, barY + 9, 120 * (xpInLevel / 100), 5);
          ctx.font = "10px monospace"; ctx.fillStyle = "#ccc";
          ctx.fillText(`Lv.${me.level} (${xpInLevel}/100)`, 170, barY + 18);
        }
      }

      if (!isMobile) {
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "12px monospace"; ctx.textAlign = "right";
        ctx.fillText("WASD: Move | Click: Target | E: Talk | Enter: Chat | Esc: Untarget", w - 10, 20);
      }

      // Update React state for HUD overlay (throttled)
      if (me && Math.floor(time / 500) !== Math.floor((time - 16) / 500)) {
        setMyStats({ hp: me.hp, maxHp: me.maxHp, xp: me.xp, level: me.level, playerClass: me.playerClass, targetId: me.targetId });
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
          flexDirection: "column", zIndex: 15, pointerEvents: "none",
        }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>💀</div>
          <div style={{ color: "#fff", fontSize: 24, fontWeight: "bold", textShadow: "2px 2px 4px rgba(0,0,0,0.8)" }}>YOU DIED</div>
          <div style={{ color: "#ccc", fontSize: 14, marginTop: 8 }}>Respawning...</div>
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
          <div>{myStats.playerClass === "ranger" ? "🏹" : "⚔️"} Lv.{myStats.level} | HP: {myStats.hp}/{myStats.maxHp} | XP: {myStats.xp % 100}/100</div>
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
