# 🎮 Browser MMO

A browser-based multiplayer RPG built with **Colyseus** (server), **React/Vite** (client), and **SQLite** (persistence). Tile-based movement, real-time combat, 4 classes, monsters, quests, loot, world events, PvP, and fishing — all in the browser.

**Play:** `http://82.25.112.219:3001`

---

## Getting Started

### Running Locally

```bash
# Server
cd server
npm install
npx tsc
node dist/index.js    # Colyseus on :2567

# Client
cd client
npm install
npx vite build

# Serve everything
cd ..
node serve.js         # → http://localhost:3001
```

**Optional env vars:**
```bash
export JWT_SECRET="your-secret-key-here"   # Default: "mmo-dev-secret-change-in-prod"
```

---

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD / Arrow Keys | D-pad |
| Click-to-walk | Click any empty tile | Tap any empty tile |
| Target enemy/player | Click on them | Tap on them |
| Attack | Auto-attacks when target in range | Same |
| Attack nearest adjacent | `X` | — |
| Vacuum loot (nearby items) | `Z` | — |
| Talk to NPC | `E` (within 2 tiles) | 💬 button |
| Fish | `F` (near water) | 🎣 button |
| Chat | `Enter` to open, type, `Enter` to send | ✏️ button |
| Clear target | `Escape` | 🚫 button |
| Abilities / Potions | `1`–`6` | Hotbar buttons |
| Inventory | `I` | 🎒 button |
| Character sheet | `C` | 📋 button |
| Quest log | `Q` | 📜 button |
| Game menu | `Escape` | ☰ button |

---

## Account System

### Authentication
- **Email-based accounts** — register with email + password
- **Multiple characters** — up to 10 per account
- **Character select screen** — pick a character or create a new one after login
- **Forgot password** — reset code flow (code logged server-side)
- **JWT tokens** — 7-day expiry, stored in localStorage

### API Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/register` | POST | No | Create account (email + password) |
| `/api/login` | POST | No | Login → JWT + character list |
| `/api/characters` | GET | JWT | List your characters |
| `/api/characters` | POST | JWT | Create new character (name, class, hardcore) |
| `/api/characters/:id` | DELETE | JWT | Delete a character |
| `/api/forgot-password` | POST | No | Request password reset code |
| `/api/reset-password` | POST | No | Reset password with code |

### Data Persistence
- **SQLite** with `better-sqlite3` (WAL mode)
- **Autosave** every 60 seconds — all players batch-saved in a single transaction
- **Save on disconnect** — immediate save when a player leaves
- **Save on room dispose** — all remaining players saved on shutdown
- **Persisted data:** Level, XP, gold, HP/MP, inventory, equipment, position, active quest progress, completed quests
- **NOT persisted:** Buffs, status effects, combat target (ephemeral state)

---

## Classes

Choose your class when creating a character. Each has unique base stats and per-level scaling.

### ⚔️ Warrior
| Stat | Base | Per Level |
|---|---|---|
| HP | 130 | +20 |
| MP | 40 | +10 |
| Attack | 22 | +4 |
| Defense | 8 | +3 |
| Attack Speed | 1.1s | — |
| Range | 1 tile (melee) | — |
| Crit | 3% | +0.3/lvl |
| Dodge | 2% | +0.2/lvl |
| MP Regen | 2/5s | — |

Tank. Highest HP, defense, and defense scaling. Abilities: Heal, Cleave, Shield Wall, War Cry.

### 🏹 Ranger
| Stat | Base | Per Level |
|---|---|---|
| HP | 85 | +15 |
| MP | 60 | +10 |
| Attack | 20 | +5 |
| Defense | 3 | +1 |
| Attack Speed | 1.4s | — |
| Range | 4 tiles | — |
| Crit | 8% | +0.5/lvl |
| Dodge | 4% | +0.3/lvl |
| MP Regen | 4/5s | — |

Ranged DPS. Fires visible arrow projectiles. Abilities: Heal, Power Shot, Frost Arrow, Rain of Arrows.

### 🔮 Mage
| Stat | Base | Per Level |
|---|---|---|
| HP | 70 | +12 |
| MP | 100 | +15 |
| Attack | 10 | +3 |
| Defense | 2 | +1 |
| Attack Speed | 1.5s | — |
| Range | 3 tiles | — |
| Crit | 5% | +0.4/lvl |
| Dodge | 3% | +0.2/lvl |
| MP Regen | 8/5s | — |

Spell caster. Massive MP pool and fastest MP regen (4x Warrior). Uses ranged abilities.

### 🗡️ Rogue
| Stat | Base | Per Level |
|---|---|---|
| HP | 80 | +14 |
| MP | 50 | +10 |
| Attack | 18 | +5 |
| Defense | 4 | +1 |
| Attack Speed | 0.9s | — |
| Range | 1 tile (melee) | — |
| Crit | 10% | +0.6/lvl |
| Dodge | 8% | +0.5/lvl |
| MP Regen | 3/5s | — |

Melee DPS. Fastest attacks, highest crit and dodge. Uses melee abilities.

---

## Combat

- **Click to target** an enemy or player → auto-attacks on your class's attack interval
- **Press X** to auto-target the closest adjacent creature
- **Damage formula:** `base_attack + random(-5 to +4)`, modified by crit/defense
- **Critical hits:** Roll against crit chance each attack. Crits deal **1.5x damage** (gold text, "CRIT!" prefix)
- **Dodge:** Roll against dodge chance when hit. Dodged attacks deal **0 damage** (cyan "DODGE" text). Also blocks status effects.
- **Defense:** Reduces incoming damage
- All distance checks use **Chebyshev distance** (diagonals count as 1 tile)

### Abilities (6-Slot Hotbar)

| Slot | Key | Warrior / Rogue | Ranger / Mage |
|---|---|---|---|
| 1 | `1` | Heal | Heal |
| 2 | `2` | Cleave | Power Shot |
| 3 | `3` | Shield Wall | Frost Arrow |
| 4 | `4` | War Cry | Rain of Arrows |
| 5 | `5` | HP Potion | HP Potion |
| 6 | `6` | MP Potion | MP Potion |

- Clock-sweep cooldown animation on abilities and potions
- Color-coded borders: green = ready, orange = cooldown, gray = can't use

### Ability Details

#### 💚 Heal (All Classes) — Key `1`
- **MP Cost:** 20
- **Cooldown:** None
- **Effect:** Restores 30 + (Magic Skill × 0.3) HP. Cannot overheal.
- **Note:** Grants Magic skill experience on use.

#### ⚔️ Cleave (Warrior / Rogue) — Key `2`
- **MP Cost:** 30
- **Cooldown:** None
- **Effect:** AoE melee attack hitting **all** enemies within 1 tile (melee range). Deals 1.2× base attack damage to each target. Can hit slimes, wolves, goblins, skeletons, bosses, and enemy players simultaneously.
- **Note:** Grants Magic skill experience on use.

#### 🏹 Power Shot (Ranger / Mage) — Key `2`
- **MP Cost:** 30
- **Cooldown:** None
- **Effect:** Fires a projectile at your current target dealing 1.5× base attack damage. Requires a target in range (4 tiles for Ranger, 3 for Mage). Can crit.
- **Note:** Grants Magic skill experience on use.

#### 🛡️ Shield Wall (Warrior / Rogue) — Key `3`
- **MP Cost:** 40
- **Cooldown:** 20 seconds
- **Duration:** 6 seconds
- **Effect:** Reduces all incoming damage by 50% for 6 seconds. Visual shield effect shown on character. Cannot recast while active.
- **Note:** Grants Magic skill experience on use.

#### ❄️ Frost Arrow (Ranger / Mage) — Key `3`
- **MP Cost:** 25
- **Cooldown:** 12 seconds
- **Effect:** Fires a frost projectile dealing 0.8× base attack damage. Applies a 4-second slow to the target, causing them to skip 50% of movement ticks. Blue frost visual on the frozen enemy. Requires a target in range.
- **Note:** Grants Magic skill experience on use.

#### 📯 War Cry (Warrior / Rogue) — Key `4`
- **MP Cost:** 35
- **Cooldown:** 25 seconds
- **Duration:** 10 seconds
- **Effect:** Grants +50% base attack as a buff for 10 seconds. Also buffs all allied players within 3 tiles with the same +50% attack bonus. Visual shockwave effect.
- **Note:** Grants Magic skill experience on use.

#### 🌧️ Rain of Arrows (Ranger / Mage) — Key `4`
- **MP Cost:** 45
- **Cooldown:** 18 seconds
- **Effect:** AoE ranged attack centered on your target. Hits all enemies within a 3-tile radius dealing 0.6× base attack per hit. Each hit rolls independently for crits. Requires a target in range.
- **Note:** Grants Magic skill experience on use.

#### ❤️ Health Potion — Key `5`
- **Cooldown:** 2 seconds (shared with MP Potion)
- **Effect:** Consumes one Health Potion from inventory, restoring 50 HP. Won't activate at full HP.

#### 💙 Mana Potion — Key `6`
- **Cooldown:** 2 seconds (shared with HP Potion)
- **Effect:** Consumes one Mana Potion from inventory, restoring 30 MP. Won't activate at full MP.

### PvP
- Players can target and attack other players
- PvP kill rewards: `50 + target.level × 10` XP
- PvP kills announced server-wide

### Hardcore Mode ☠️
- Opt-in at character creation
- **Death is permanent** — character deleted from database on death
- No respawn, no second chances

### Death & Respawn (Normal)

| Event | Timer |
|---|---|
| Player death | 5s respawn at village center (full HP/MP) |
| Slime death | 15s respawn at original location |
| Wolf death | 30s respawn at original location |

---

## Skill System

Characters have 4 trainable skills that improve through use. Each action has a chance to grant skill tries, with class multipliers determining how fast each skill levels.

### Skills

| Skill | Trained By | Bonus |
|---|---|---|
| ⚔️ Melee | Melee auto-attacks | +0.5 damage per skill level |
| 🏹 Ranged | Ranged auto-attacks | +0.5 damage per skill level |
| 🔮 Magic | Heal, abilities (all spells) | +0.3 heal per skill level |
| 🛡️ Shielding | Getting hit in PvP | +0.3 damage reduction per skill level |

### Leveling Formula

Tries needed per level: `floor(50 × 1.1^level)`

| Level | Tries Needed |
|---|---|
| 1 → 2 | 55 |
| 5 → 6 | 81 |
| 10 → 11 | 130 |
| 20 → 21 | 337 |
| 50 → 51 | 5,869 |

### Class Multipliers

Each action grants `1 × multiplier` tries toward the relevant skill. Higher multipliers mean faster training.

| Class | Melee | Ranged | Magic | Shielding |
|---|---|---|---|---|
| Warrior | **1.5×** | 0.5× | 0.5× | **1.5×** |
| Ranger | 0.5× | **1.5×** | 0.8× | 0.8× |
| Mage | 0.5× | 0.8× | **1.5×** | 0.5× |
| Rogue | **1.2×** | 0.5× | 0.5× | 0.8× |

---

## Monsters

### Neutral — Slimes 🟢🔵🔴🟣

Won't attack unless provoked. Chase their attacker using BFS pathfinding.

| Type | HP | ATK | XP | Size |
|---|---|---|---|---|
| Green Slime | 30 | 8 + rand(0–5) | 15 | Small |
| Blue Slime | 50 | 8 + rand(0–5) | 25 | Normal |
| Red Slime | 100 | 8 + rand(0–5) | 50 | Big |
| Purple Slime | 70 | 8 + rand(0–5) | 35 | Normal |

### Aggressive — Wolves 🐺

Always hostile. Chase any player within aggro range.

| Stat | Value |
|---|---|
| HP | 150 |
| Attack | 20 + rand(0–7) |
| XP | 75 |
| Attack speed | 1.5s |
| Aggro range | 8 tiles |
| Leash range | 15 tiles |
| Respawn | 30s |

### Aggressive — Goblins 👹

3 variants: normal, archer, shaman.

| Stat | Value |
|---|---|
| HP | 80 |
| Attack | 15 |
| XP | 50 |

### Aggressive — Skeletons 💀

Spawn at map edges. Tougher enemies.

| Stat | Value |
|---|---|
| HP | 200 |
| Attack | 30 |
| XP | 120 |

---

## Loot System

- Monsters drop items **on the ground** when killed
- Items render with glowing halos (gold = coins, blue = equipment, green = consumables)
- Floating bob animation on dropped items
- **Click** or **walk over** to pick up
- **Press Z** to vacuum-loot all nearby items (your tile + 8 surrounding)
- **Loot protection:** Only the killer can loot for 5 seconds, then free for all
- Items despawn after 60 seconds

### Equipment
- Weapons, helmets, chest armor, legs, boots
- Equipment provides stat bonuses: ATK, DEF, Max HP, Max MP
- Equip from inventory to gear slots
- Item stat tooltips on hover (desktop) or tap-and-hold (mobile)

### Shop
- Buy/sell items at the merchant NPC
- Sell price shown on all items

---

## Quest System

7 quests across 5 NPCs with kill objectives and progression chains.

| Quest | NPC | Target | Reward |
|---|---|---|---|
| Slime Trouble | Elder Oak | Kill 5 slimes | XP + Gold |
| Wolf Menace | Elder Oak | Kill 3 wolves | XP + Gold (requires Slime Trouble) |
| Goblin Raiders | Mira | Kill 4 goblins | XP + Gold |
| Undead Scourge | Forge | Kill 3 skeletons | XP + Gold + Iron Sword |
| Dragon Slayer | Pip | Kill the dragon | XP + Gold + Fire Staff |
| Slime Bounty | Old Gil | Kill slimes (repeatable) | XP + Gold |
| Wolf Bounty | Old Gil | Kill wolves (repeatable) | XP + Gold |

- **Quest markers:** Yellow `!` = available, `?` = ready to turn in
- **Quest log:** Press `Q` to view active quests, progress bars, abandon option
- **Quest tracker HUD** in top-left shows active quest progress
- Max 5 active quests at once
- **Active quest progress persists** across sessions (kill counts saved to DB)
- Completed quests tracked permanently

---

## World Events

Random events spawn every 2–5 minutes in the wilderness:

| Event | Duration | Effect |
|---|---|---|
| 💰 Treasure Chest | 60s | Walk to open — 100–300 gold + loot drops |
| 🔮 Mana Shrine | 45s | Stand nearby — regen +10 HP/MP per second, cure poison/burn |
| ✨ Golden Slime | 90s | Rare 500 HP creature that runs away — 300 XP, 200–500 gold, rare drops |
| ⭐ XP Orb | 30s | First player to reach it absorbs +150 XP |

- Events shown on minimap with color-coded pulsing markers
- Notification banners announce spawns and claims to all players

---

## Fishing 🎣

- Press `F` near water to cast your line
- Animated progress bar with bobber and water shimmer
- Moving cancels your cast

| Catch | Rarity | Effect |
|---|---|---|
| 🐟 Small Fish | Common | Heals 20 HP |
| 🐠 Big Fish | Uncommon | Heals 60 HP |
| ✨🐟 Golden Fish | Rare | Heals 100 HP + 50 MP |
| 🧰 Sunken Treasure | Legendary | +200 gold |

- +10 XP per successful catch
- Fish can be sold at the merchant

---

## World

- **Map size:** 64×64 tiles (64px per tile)
- **Village:** Centered around tile (36, 36), bordered by trees with 4 entrances
- **Spawn point:** Tile (36, 37) — village center
- **Buildings:** Inn, Shop, Blacksmith, Elder's house
- **Terrain:** Grass, dirt paths, trees, rocks, water, bridges, flowers
- **Blocked tiles:** Trees, rocks, water, walls (collision)

### NPCs

| NPC | Location | Function |
|---|---|---|
| Elder Oak | SE house | Quest giver |
| Mira | Village | Quest giver |
| Forge | SW house | Quest giver (Blacksmith) |
| Pip | Village | Quest giver + Shop |
| Old Gil | Village | Repeatable bounties |

---

## UI Features

- **Minimap** — top-right, color-coded dots for monsters/players, viewport rectangle
- **Target info frame** — top-center, shows target name + HP bar
- **Quest tracker** — top-left, active quest progress bars
- **6-slot hotbar** — abilities + potions with cooldown sweep animations
- **Inventory** (`I`) — 5×4 grid with item tooltips and equip/use buttons
- **Character sheet** (`C`) — all stats, equipment breakdown, XP progress
- **Quest log** (`Q`) — active quests with progress and abandon option
- **Game menu** (`Esc` / ☰) — inventory, character sheet, controls reference, logout
- **Kill feed** — level ups, PvP kills, quest completions, world events (below minimap)
- **Chat** — `Enter` to open, type, send

### Visual Effects
- Death animation (red flash, fade, falling skull)
- Level-up golden particle burst + expanding ring
- Combat hit particles (color-coded by monster type)
- Camera shake on damage taken
- Footstep dust particles while moving
- Weapon glow effects near player hand
- Floating damage numbers (red = physical, gold = crit, cyan = dodge, green = heal)
- Ambient forest sounds (procedural wind + bird chirps)

---

## Tech Stack

| Component | Tech |
|---|---|
| Server | Colyseus (Node.js) + Express |
| Client | React + Vite |
| Database | SQLite (better-sqlite3, WAL mode) |
| Auth | bcryptjs + jsonwebtoken (JWT) |
| Rendering | HTML5 Canvas (pixel art) |
| Networking | WebSocket (Colyseus protocol) |
| State sync | Colyseus Schema |

### Architecture

```
client (React/Vite) ──► serve.js (Express :3001) ──► Colyseus (:2567)
                         ├── static files              ├── GameRoom
                         ├── /api/* proxy               ├── SQLite (game.db)
                         ├── /matchmake/* proxy         └── JWT auth
                         └── WebSocket upgrade proxy
```

### Dependencies

**Server:**
- `@colyseus/core`, `@colyseus/schema`, `@colyseus/ws-transport`
- `better-sqlite3` — SQLite database
- `bcryptjs` — password hashing
- `jsonwebtoken` — JWT tokens
- `express`, `cors`

**Client:**
- `react`, `react-dom`
- `colyseus.js`
- `vite`
