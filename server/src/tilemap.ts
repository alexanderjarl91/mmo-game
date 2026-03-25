// Tile types
export const TILE = {
  GRASS: 0,
  PATH: 1,
  WATER: 2,
  TREE: 3,
  ROCK: 4,
  FLOWERS: 5,
  BRIDGE: 6,
  WALL: 7,
  FLOOR: 8,
  TEMPLE: 9,
  CAVE_FLOOR: 20,
  CAVE_WALL: 21,
  WEB: 22,
  CAVE_ENTRY: 23,
  CAVE_EXIT: 24,
} as const;

export const BLOCKED = new Set<number>([TILE.TREE, TILE.ROCK, TILE.WATER, TILE.WALL, TILE.CAVE_WALL]);

export const MAP_W = 64;
export const MAP_H = 64;

// Village is centered at (32, 32) roughly
const VX = 28; // village top-left x
const VY = 28; // village top-left y
const VS = 8;  // village "radius" from center

function generateMap(): number[][] {
  const map: number[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    map[y] = [];
    for (let x = 0; x < MAP_W; x++) {
      map[y][x] = TILE.GRASS;
    }
  }

  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H) map[y][x] = t;
  };
  const fill = (x1: number, y1: number, x2: number, y2: number, t: number) => {
    for (let y = Math.max(0, y1); y <= Math.min(MAP_H - 1, y2); y++)
      for (let x = Math.max(0, x1); x <= Math.min(MAP_W - 1, x2); x++) set(x, y, t);
  };

  // ── World border (trees around edge) ──
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (x === 0 || x === MAP_W - 1 || y === 0 || y === MAP_H - 1) {
        set(x, y, TILE.TREE);
      }
    }
  }

  // ── Scattered forest throughout the outer areas ──
  // Use a seeded pseudo-random for determinism
  const hash = (x: number, y: number) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) & 0x7fffffff;
  };

  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      // Skip village area
      if (x >= VX - 2 && x <= VX + VS * 2 + 2 && y >= VY - 2 && y <= VY + VS * 2 + 2) continue;

      const h = hash(x, y);
      // ~25% trees in outer areas
      if (h % 100 < 22) set(x, y, TILE.TREE);
      else if (h % 100 < 25) set(x, y, TILE.ROCK);
      else if (h % 100 < 28) set(x, y, TILE.FLOWERS);
    }
  }

  // ── Village wall (tree border with 4 entrances) ──
  const vx1 = VX, vy1 = VY;
  const vx2 = VX + VS * 2, vy2 = VY + VS * 2;
  const vmx = Math.floor((vx1 + vx2) / 2); // village midpoint x
  const vmy = Math.floor((vy1 + vy2) / 2); // village midpoint y

  // Tree border around village
  for (let x = vx1; x <= vx2; x++) {
    set(x, vy1, TILE.TREE);
    set(x, vy2, TILE.TREE);
  }
  for (let y = vy1; y <= vy2; y++) {
    set(vx1, y, TILE.TREE);
    set(vx2, y, TILE.TREE);
  }

  // Clear 3-wide entrances (N, S, E, W)
  for (let i = -1; i <= 1; i++) {
    set(vmx + i, vy1, TILE.PATH); // north
    set(vmx + i, vy2, TILE.PATH); // south
    set(vx1, vmy + i, TILE.PATH); // west
    set(vx2, vmy + i, TILE.PATH); // east
  }

  // ── Clear inside village ──
  fill(vx1 + 1, vy1 + 1, vx2 - 1, vy2 - 1, TILE.GRASS);

  // ── Village paths (cross shape) ──
  for (let i = vy1; i <= vy2; i++) set(vmx, i, TILE.PATH); // vertical
  for (let i = vx1; i <= vx2; i++) set(i, vmy, TILE.PATH); // horizontal

  // Village square in center
  fill(vmx - 2, vmy - 2, vmx + 2, vmy + 2, TILE.PATH);

  // ── Roads leading out from village ──
  // North road
  for (let y = 1; y < vy1; y++) {
    for (let dx = -1; dx <= 1; dx++) {
      const rx = vmx + dx;
      if (map[y][rx] !== TILE.WATER) set(rx, y, TILE.PATH);
    }
  }
  // South road
  for (let y = vy2 + 1; y < MAP_H - 1; y++) {
    for (let dx = -1; dx <= 1; dx++) {
      const rx = vmx + dx;
      if (map[y][rx] !== TILE.WATER) set(rx, y, TILE.PATH);
    }
  }
  // West road
  for (let x = 1; x < vx1; x++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ry = vmy + dy;
      if (map[ry][x] !== TILE.WATER) set(x, ry, TILE.PATH);
    }
  }
  // East road
  for (let x = vx2 + 1; x < MAP_W - 1; x++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ry = vmy + dy;
      if (map[ry][x] !== TILE.WATER) set(x, ry, TILE.PATH);
    }
  }

  // Clear trees ON the roads
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (map[y][x] === TILE.PATH) {
        // Also clear adjacent trees that might block
      }
    }
  }

  // ── Houses ──
  // House 1: Inn (NW of village center)
  const h1x = vmx - 5, h1y = vmy - 5;
  fill(h1x, h1y, h1x + 3, h1y + 3, TILE.WALL);
  fill(h1x + 1, h1y + 1, h1x + 2, h1y + 2, TILE.FLOOR);
  set(h1x + 2, h1y + 3, TILE.PATH);

  // House 2: Shop (NE)
  const h2x = vmx + 3, h2y = vmy - 5;
  fill(h2x, h2y, h2x + 3, h2y + 3, TILE.WALL);
  fill(h2x + 1, h2y + 1, h2x + 2, h2y + 2, TILE.FLOOR);
  set(h2x + 1, h2y + 3, TILE.PATH);

  // House 3: Blacksmith (SW)
  const h3x = vmx - 5, h3y = vmy + 3;
  fill(h3x, h3y, h3x + 3, h3y + 3, TILE.WALL);
  fill(h3x + 1, h3y + 1, h3x + 2, h3y + 2, TILE.FLOOR);
  set(h3x + 2, h3y, TILE.PATH);

  // House 4: Elder (SE)
  const h4x = vmx + 3, h4y = vmy + 3;
  fill(h4x, h4y, h4x + 3, h4y + 3, TILE.WALL);
  fill(h4x + 1, h4y + 1, h4x + 2, h4y + 2, TILE.FLOOR);
  set(h4x + 1, h4y, TILE.PATH);

  // Connect houses to paths
  for (let x = h1x + 2; x <= vmx; x++) set(x, h1y + 3, TILE.PATH);
  for (let x = vmx; x <= h2x + 1; x++) set(x, h2y + 3, TILE.PATH);
  for (let x = h3x + 2; x <= vmx; x++) set(x, h3y, TILE.PATH);
  for (let x = vmx; x <= h4x + 1; x++) set(x, h4y, TILE.PATH);

  // ── Temple (south of village center) ──
  const tx = vmx - 3, ty = vmy + 6;
  // 7x6 building with walls and temple floor
  fill(tx, ty, tx + 6, ty + 5, TILE.WALL);
  fill(tx + 1, ty + 1, tx + 5, ty + 4, TILE.TEMPLE); // 5×4 interior
  // 2-tile wide entrance (north side, facing village)
  set(tx + 3, ty, TILE.PATH);
  set(tx + 4, ty, TILE.PATH);
  // Path connecting temple to village center road
  for (let y = vmy; y <= ty; y++) set(vmx, y, TILE.PATH);
  set(vmx + 1, ty, TILE.PATH); // widen path at entrance

  // ── Pond (NE outside village) ──
  const px = vmx + 12, py = vmy - 10;
  fill(px, py, px + 5, py + 4, TILE.WATER);
  fill(px + 1, py - 1, px + 4, py - 1, TILE.WATER);
  fill(px + 1, py + 5, px + 4, py + 5, TILE.WATER);
  // Bridge
  set(px, py + 1, TILE.BRIDGE);
  set(px, py + 2, TILE.BRIDGE);
  set(px, py + 3, TILE.BRIDGE);
  // Clear area around pond
  for (let dy = -2; dy <= 6; dy++) {
    for (let dx = -2; dx <= 7; dx++) {
      const tx = px + dx, ty = py + dy;
      if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && map[ty][tx] === TILE.TREE) {
        if (Math.abs(dx) > 1 || Math.abs(dy - 2) > 3) continue;
        set(tx, ty, TILE.GRASS);
      }
    }
  }

  // ── Southern lake ──
  const lx = vmx - 8, ly = vmy + 14;
  fill(lx, ly, lx + 7, ly + 4, TILE.WATER);
  fill(lx + 2, ly - 1, lx + 5, ly - 1, TILE.WATER);
  fill(lx + 1, ly + 5, lx + 6, ly + 5, TILE.WATER);
  // Bridge across
  set(lx + 3, ly, TILE.BRIDGE);
  set(lx + 4, ly, TILE.BRIDGE);

  // ── Flower garden (west of village) ──
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -8; dx <= -5; dx++) {
      const fx = vmx + dx, fy = vmy + dy;
      if (fx >= 0 && fy >= 0 && fx < MAP_W && fy < MAP_H && map[fy][fx] === TILE.GRASS) {
        set(fx, fy, TILE.FLOWERS);
      }
    }
  }

  // ── Clearing in the NW forest ──
  const cx = 8, cy = 8;
  fill(cx, cy, cx + 5, cy + 5, TILE.GRASS);
  set(cx + 2, cy + 2, TILE.ROCK);
  set(cx + 3, cy + 3, TILE.FLOWERS);

  // ── Village center flowers ──
  set(vmx - 1, vmy - 1, TILE.FLOWERS);
  set(vmx + 1, vmy - 1, TILE.FLOWERS);
  set(vmx - 1, vmy + 1, TILE.FLOWERS);
  set(vmx + 1, vmy + 1, TILE.FLOWERS);

  // ── Spider Queen's Lair (NE corner dungeon) ──
  // First, fill entire dungeon bounding box with CAVE_WALL
  fill(48, 1, 62, 18, TILE.CAVE_WALL);

  // Entrance room at ~(50, 16) — 5x3
  fill(49, 15, 53, 17, TILE.CAVE_FLOOR);
  set(50, 16, TILE.CAVE_EXIT); // exit portal
  set(52, 16, TILE.CAVE_ENTRY); // entrance marker

  // Room 1 (Spiderling Nest): (50-55, 12-14)
  fill(50, 12, 55, 14, TILE.CAVE_FLOOR);
  // Web decorations
  set(51, 13, TILE.WEB);
  set(54, 12, TILE.WEB);
  set(53, 14, TILE.WEB);

  // Tunnel from entrance to Room 1
  fill(51, 15, 52, 15, TILE.CAVE_FLOOR); // already overlaps, but ensures connection

  // Tunnel north from Room 1 to Room 2
  fill(52, 10, 53, 11, TILE.CAVE_FLOOR);

  // Room 2 (Web Chamber): (50-56, 7-9)
  fill(50, 7, 56, 9, TILE.CAVE_FLOOR);
  // Web decorations
  set(51, 8, TILE.WEB);
  set(53, 7, TILE.WEB);
  set(55, 9, TILE.WEB);
  set(50, 7, TILE.WEB);

  // Tunnel from Room 2 to Boss
  fill(53, 5, 54, 6, TILE.CAVE_FLOOR);

  // Boss Chamber: large room (50-58, 2-4)
  fill(50, 2, 58, 4, TILE.CAVE_FLOOR);
  // Web decorations in boss room
  set(51, 2, TILE.WEB);
  set(57, 2, TILE.WEB);
  set(50, 4, TILE.WEB);
  set(58, 4, TILE.WEB);
  set(54, 3, TILE.WEB);

  return map;
}

export const WORLD_MAP = generateMap();

export interface NPCDef {
  id: string;
  x: number;
  y: number;
  name: string;
  color: string;
  direction: string;
  dialogue: string[];
}

const vmx = Math.floor((VX + VX + VS * 2) / 2);
const vmy = Math.floor((VY + VY + VS * 2) / 2);

export const NPCS: NPCDef[] = [
  {
    id: "elder",
    x: vmx, y: vmy - 1,
    name: "Elder Oak",
    color: "#f39c12",
    direction: "down",
    dialogue: [
      "Welcome to Greendale village, traveler!",
      "This land was once filled with dangerous creatures...",
      "But brave adventurers like you drove them away.",
      "Feel free to explore. The forest holds many secrets.",
      "There's a pond to the northeast, and a lake to the south.",
    ],
  },
  {
    id: "innkeeper",
    x: vmx - 3, y: vmy - 2,
    name: "Mira",
    color: "#e91e63",
    direction: "down",
    dialogue: [
      "Welcome to the Cozy Hearth Inn!",
      "We don't have beds yet, but the fire is warm.",
      "I hear there's treasure hidden in the eastern forest...",
    ],
  },
  {
    id: "blacksmith",
    x: vmx - 3, y: vmy + 3,
    name: "Forge",
    color: "#795548",
    direction: "up",
    dialogue: [
      "*clang* *clang* Oh, hello there!",
      "I'm working on a new sword. Come back later!",
      "The rocks near the pond have good iron ore.",
    ],
  },
  {
    id: "merchant",
    x: vmx + 4, y: vmy - 2,
    name: "Pip",
    color: "#4caf50",
    direction: "down",
    dialogue: [
      "Welcome to Pip's Potions! Press E to browse.",
      "Health potions, mana potions — I've got what you need!",
      "Kill some monsters and come back with gold!",
    ],
  },
  {
    id: "fisherman",
    x: vmx + 12, y: vmy - 10,
    name: "Old Gil",
    color: "#2196f3",
    direction: "right",
    dialogue: [
      "Shh... you'll scare the fish.",
      "I've been fishing this pond for 40 years.",
      "Never caught anything. But tomorrow could be the day!",
    ],
  },
  {
    id: "priestess",
    x: 36, y: 46,
    name: "Priestess Luna",
    color: "#e1bee7",
    direction: "up",
    dialogue: [
      "Welcome to the Temple of Light, weary traveler.",
      "Rest here and your wounds shall heal swiftly.",
      "The temple's blessing restores body and spirit alike.",
      "May the light guide your path through the wilderness.",
    ],
  },
  {
    id: "cragbeard",
    x: 36, y: 26,
    name: "Old Cragbeard",
    color: "#8B4513",
    direction: "down",
    dialogue: [
      "Deep beneath the northern caves lies the Spider Queen's Lair...",
      "Many have entered. Few return.",
      "Recommended: Level 10, Party of 2+",
      "The cave entrance lies to the northeast. Shall I guide you there?",
    ],
  },
];
