# 🎮 Browser MMO

A browser-based multiplayer RPG built with **Colyseus** (server) and **React/Vite** (client). Tile-based movement, real-time combat, classes, monsters, and PvP — all in the browser.

**Play:** `http://82.25.112.219:3001`

---

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD / Arrow Keys | D-pad |
| Target enemy/player | Click on them | Tap on them |
| Attack | Auto-attacks when target in range | Same |
| Heal | Press `1` | 💚 button |
| Talk to NPC | Press `E` (within 2 tiles) | 💬 button |
| Chat | `Enter` to open, type, `Enter` to send | ✏️ button |
| Clear target | `Escape` | 🚫 button |

---

## Classes

Choose your class at the login screen.

### ⚔️ Warrior

| Stat | Base | Per Level |
|---|---|---|
| HP | 120 | +20 |
| MP | 40 | +10 |
| Attack | 30 | +5 |
| Attack Speed | 1.0s | — |
| Range | 1 tile (melee) | — |

Tanks that hit hard up close. Must be adjacent (including diagonals) to attack.

### 🏹 Ranger

| Stat | Base | Per Level |
|---|---|---|
| HP | 80 | +20 |
| MP | 60 | +10 |
| Attack | 20 | +5 |
| Attack Speed | 1.5s | — |
| Range | 4 tiles | — |

Fragile but can shoot from a distance. Fires visible arrow projectiles. Keeps target locked even when out of range (warrior loses target).

---

## Leveling

| Stat | Value |
|---|---|
| XP per level | 100 |
| XP formula | `level = floor(totalXP / 100) + 1` |
| On level up | Full HP, MP, and attack restored |

All stats scale the same per level for both classes (+20 HP, +10 MP, +5 ATK). The difference is the base values.

---

## Mana & Spells

| Stat | Value |
|---|---|
| Mana regen | +2 MP every 2 seconds |
| Regen condition | Alive (stops when dead) |

### 💚 Heal (Key: `1`)

| Property | Value |
|---|---|
| Cost | 20 MP |
| Heal amount | 30 HP |
| Condition | Must be alive, must have enough MP, HP must not be full |

Shows a green `+30` floating number on heal.

---

## Monsters

### Neutral — Slimes 🟢🔵🔴🟣

Slimes **don't attack you** unless you hit them first. Once attacked, they aggro on their attacker and chase.

| Type | HP | XP | Size |
|---|---|---|---|
| Green Slime | 30 | 15 | Small |
| Blue Slime | 50 | 25 | Normal |
| Red Slime | 100 | 50 | Big |
| Purple Slime | 70 | 35 | Normal |

**Behavior:**
- **Neutral:** Wander randomly outside the village
- **Aggroed:** Chase attacker using BFS pathfinding (navigates around obstacles)
- **Attack:** 8 + random(0–5) damage every 2 seconds at melee range
- **De-aggro:** Target dies or gets 8+ tiles away
- **Respawn:** 15 seconds after death

### Aggressive — Wolves 🐺

Wolves are **always hostile** — they chase any player that enters their aggro range.

| Stat | Value |
|---|---|
| HP | 150 |
| Attack | 20 + random(0–7) |
| XP reward | 75 |
| Attack speed | 1.5s |
| Move speed | 500ms per tile |
| Aggro range | 8 tiles |
| Leash range | 16 tiles |
| Respawn | 30 seconds |

**Behavior:**
- Patrol wilderness, won't enter the village (tiles 28–44)
- Aggro on nearest player within 8 tiles
- Chase using BFS pathfinding (navigate around trees, rocks, etc.)
- Prefer cardinal movement (up/down/left/right), only move diagonally when needed
- Give up chase if player gets 16+ tiles away
- Attack at melee range (1 tile, including diagonals)

---

## Combat

- **Click to target** an enemy or player → auto-attacks on your class's attack interval
- **Damage formula:** `base_attack + random(-5 to +4)` (player), fixed formulas for monsters
- All distance checks use **Chebyshev distance** (diagonals count as 1 tile)
- Red pulsing highlight on targeted entity

### PvP

- Players can target and attack other players
- Slimes are prioritized over players as targets
- PvP kill rewards: `50 + target.level × 10` XP
- Dead players respawn after 5 seconds at village center

### Death & Respawn

| Event | Timer |
|---|---|
| Player death | 5s respawn at village center (full HP/MP) |
| Slime death | 15s respawn at original location |
| Wolf death | 30s respawn at original location |

---

## World

- **Map size:** 64×64 tiles
- **Tile size:** 64px
- **Village:** Centered around tile (36, 36), bordered by trees with 4 entrances
- **Spawn point:** Tile (36, 37) — village center
- **Buildings:** 4 houses (Inn, Shop, Blacksmith, Elder's house)
- **Terrain:** Grass, dirt paths, trees, rocks, water, bridges, flowers
- **Blocked tiles:** Trees, rocks, water, walls (collision)

### NPCs

5 NPCs in the village with dialogue (press `E` within 2 tiles):

| NPC | Location |
|---|---|
| Elder Oak | SE house |
| Mira | Village area |
| Forge | SW house (Blacksmith) |
| Pip | Village area |
| Old Gil | Village area |

---

## Tech Stack

| Component | Tech |
|---|---|
| Server | Colyseus (Node.js) |
| Client | React + Vite |
| Rendering | HTML5 Canvas (hand-drawn pixel art) |
| Networking | WebSocket (Colyseus protocol) |
| State sync | Colyseus Schema |

### Architecture

```
client (React/Vite) ──► serve.js (Express :3001) ──► Colyseus (:2567)
                         ├── static files
                         ├── /matchmake/* proxy
                         └── WebSocket upgrade proxy
```

### Running Locally

```bash
# Server
cd server
npm install
npx tsc
node dist/index.js

# Client
cd client
npm install
npx vite build

# Serve everything
cd ..
node serve.js
# → http://localhost:3001
```
