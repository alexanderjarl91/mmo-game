# 🎮 Creative Sprint Changelog

## Class System Overhaul — 4 Classes with Distinct Progression

### 🗡️ 4-Class System with Unique Stats
- Expanded from 2 classes (Warrior/Ranger) to **4 classes**: Warrior, Ranger, Mage, Rogue
- Each class has unique base stats and per-level growth rates for: HP, MP, ATK, DEF, Range, Attack Speed, Crit %, Dodge %, MP Regen
- **Warrior** — Tank. HP 130, DEF 8, ATK 22, 1.1s speed. Highest defense scaling (+3/level)
- **Ranger** — Ranged DPS. HP 85, Range 4, Crit 8%, 1.4s speed. Good crit scaling
- **Mage** — Spell Caster. HP 70, MP 100, MP Regen 8/5s, Range 3. Massive MP pool and regen
- **Rogue** — Melee DPS. HP 80, ATK 18, 0.9s speed, Crit 10%, Dodge 8%. Fastest attacks, highest crit & dodge

### ⚔️ Crit & Dodge Mechanics
- **Critical Hits**: Players roll against their crit chance on every attack. Crits deal **1.5x damage** and display with gold/yellow color and "CRIT!" prefix in larger font
- **Dodge**: When receiving damage from mobs or PvP, players roll against dodge chance. Dodged attacks deal **0 damage** and show "DODGE" in cyan floating text
- Dodge prevents status effects (poison, burn) from being applied on that hit
- Both stats scale with level: `base + (level - 1) * perLevel`

### 🔄 Class-Based MP Regeneration
- Replaced flat 2 MP/tick regen with class-specific regen rates (mpRegen per 5 seconds)
- Warrior: 2/5s, Ranger: 4/5s, **Mage: 8/5s**, Rogue: 3/5s — Mage regens 4x faster than Warrior
- Temple 10x multiplier still applies

### 🛡️ Base Defense System
- Defense is no longer equipment-only. Classes now have base defense + per-level growth
- Formula: `defBase + (level - 1) * defPerLevel + equipBonus`
- Warrior scales +3 DEF/level; others scale +1/level
- PvP now properly runs through defense calculation

### 📋 Enhanced Character Sheet
- Shows all new stats: Crit %, Dodge %, MP Regen, Attack Speed
- 4-column layout for Attack/Defense/Range/Attack Speed
- Secondary row for Crit/Dodge/MP Regen with themed colors
- Class display now shows correct icon and name for all 4 classes

### 🎭 Character Creation
- Class selection screen shows all 4 classes with descriptions and key stats
- Mage (🔮) and Rogue (🗡️) tiles with unique color themes
- Mage uses Ranger abilities (ranged), Rogue uses Warrior abilities (melee)

### 🔧 Code Quality
- Centralized level-up logic into `checkLevelUp()` method — eliminated 5 duplicate inline level-up blocks
- Added `calcPlayerDamage()` helper with built-in crit rolling
- All stat scaling uses class config growth rates instead of hardcoded values

## Bug Fixes

### 🐛 Fix: Client crash on droppedItems/worldEvents schema listeners
- Fixed `undefined is not an object (evaluating 'k.state.droppedItems.onAdd')` crash
- Added null guards around `.onAdd()` / `.onRemove()` listeners for `droppedItems` and `worldEvents` MapSchema properties
- Root cause: client tried to attach listeners before schema properties were synced from server

## Features Added

### 24. ☰ Game Menu Button + Panel
- Added a **menu button** (☰) in the bottom-right corner, always visible on desktop and mobile
- Clicking the button or pressing **Escape** toggles the game menu open/closed
- Menu options:
  - **🎒 Inventory** — opens inventory panel (same as I key)
  - **📋 Character Sheet** — opens character sheet (same as C key)
  - **🎮 Controls** — shows a comprehensive list of all keybindings organized by category (Movement, Combat, Interaction, Interface)
  - **⚙️ Settings** — shown but greyed out / disabled (coming soon)
- Escape priority: closes open panels first (inventory, character sheet, shop, quest log, etc.), then toggles the menu
- Controls panel lists: WASD/arrows, click-to-target, X attack adjacent, Z vacuum loot, E talk to NPC, F fishing, 1-6 abilities/potions, I/C/Q/M/Enter/Esc shortcuts
- Styled consistently with existing game panels (gradient backgrounds, colored borders)
- Mobile-friendly: button positioned above mobile controls; works with touch

### 23. 🖱️ Click-to-Loot Auto-Walk
- Click any dropped item on the ground, even if far away
- Character automatically walks toward the item and picks it up on arrival
- Manual movement (WASD/arrows/d-pad) cancels auto-walk
- Clicking another target also cancels the loot walk
- If the item despawns or is picked up by someone else, walk is cancelled

### 22. 🧹 Z Key — Vacuum Loot Pickup
- Press **Z** to pick up ALL dropped items on your tile and 8 surrounding tiles
- Sends a pickup message for each nearby item — no more clicking one by one
- "Vacuum loot" hotkey for fast post-combat cleanup

### 21. ⚔️ X Key — Attack Adjacent Creature
- Press **X** to auto-target and attack the closest creature on an adjacent tile (including diagonals)
- If you already have a target, X does nothing (server handles auto-attack)
- Melee convenience — no need to click-target first
- Works with all creature types: slimes, wolves, goblins, skeletons, bosses

### 20. 📋 Character Sheet (C Key)
- Press **C** to open a detailed character sheet panel
- Shows: name, class, level, XP bar with progress
- HP/MP with base + equipment breakdown
- Attack, Defense, Range stats with base + bonus
- Full equipment list showing each slot and its bonuses
- Gold amount
- Mobile button (📋) added to HUD
- Close with **C** again or **Escape**

### 19. 📊 Item Stats Tooltips in Inventory
- Hovering over any item in inventory shows a detailed tooltip
- **Equipment** shows: ATK, DEF, Max HP, Max MP bonuses
- **Consumables** shows: HP/MP healing amounts
- Tooltip follows mouse cursor with smart screen-edge positioning
- **Mobile**: tap-and-hold (400ms) to show tooltip
- Works on both inventory grid items and equipped gear slots
- Sell price shown on all items

### 18. 🔥 Kill Streak System
- Track consecutive monster kills without dying
- **5 milestones:** 🔥 Killing Spree (3) → ⚡ Rampage (5) → 💀 Unstoppable (8) → ☠️ Godlike (12) → 👑 Legendary (20)
- Each milestone grants **bonus XP and gold** (25–500 XP, 10–250 gold)
- **Dramatic center-screen banner** with glow effect and scale-in animation on milestones
- Kill streak count (🔥 N kills) shown above all players with 3+ kills, color-coded by tier
- **Camera shake** on 5+ kill streaks for extra impact
- Kill feed broadcasts streak milestones and streak-ending deaths to all players
- Streak resets on death — creates risk/reward tension in combat

### 17. ⚡ Expanded 6-Slot Ability Bar with Cooldown Sweeps
- Hotbar expanded from 4 → 6 slots showing **all class abilities**
- **Warrior:** Heal | Cleave | Shield Wall | War Cry | HP Pot | MP Pot
- **Ranger:** Heal | Power Shot | Frost Arrow | Rain of Arrows | HP Pot | MP Pot
- **Clock-sweep cooldown animation** — dark overlay sweeps clockwise like classic MMO cooldowns
- Cooldown timer shows remaining seconds in large text on the slot
- **Color-coded borders:** green = ready, orange = on cooldown, gray = can't use
- Ability name labels on defensive/AOE slots for clarity
- Keys: 1=Heal, 2=Attack, 3=Defense/CC, 4=AOE/Buff, 5=HP Pot, 6=MP Pot

### 16. 🌟 World Events System
- **Random events** spawn every 2–5 minutes across the wilderness (first event within 30–60s)
- **💰 Treasure Chest**: Walk/click to open — rewards 100–300 gold + bonus loot drops (60s timer)
- **🔮 Mana Shrine**: Stand within 2 tiles to regenerate HP/MP (+10 each per second) and cure poison/burn (45s timer)
- **✨ Golden Slime**: Rare 500 HP creature that **runs away** from players — kill it for 300 XP, 200–500 gold, and guaranteed rare drops (90s before it escapes)
- **⭐ XP Orb**: First player to reach it absorbs +150 XP (30s timer)
- All events shown on **minimap** with color-coded pulsing markers (gold/blue/yellow/purple)
- **Notification banners** at top center announce spawns, claims, and expiry to all players
- Golden Slime is fully targetable — auto-attacks, ranger projectiles, abilities all work
- Walk over chests and XP orbs for automatic interaction
- Events broadcast server-wide: "💰 Alex opened the Treasure Chest!" etc.

### 15. 🎣 Fishing System
- Press **F** near water to cast your line
- Animated fishing progress bar with bobber and water shimmer
- **4 catches**: 🐟 Small Fish (common), 🐠 Big Fish (uncommon), ✨🐟 Golden Fish (rare), 🧰 Sunken Treasure (legendary)
- Fish are consumable: Small Fish heals 20 HP, Big Fish heals 60 HP, Golden Fish heals 100 HP + 50 MP
- Sunken Treasure gives 200 gold on catch
- +10 XP per successful catch
- Moving cancels your cast — stay still!
- Sell fish to the merchant for gold

### 14. 💎 Ground Loot Drops
- Monsters now drop items **on the ground** when killed instead of auto-looting
- Dropped items render with **glowing halos** — gold glow for coins, blue for equipment, green for consumables
- Items bob up and down with a floating animation
- **Click** dropped items or **walk over** them to pick up (auto-pickup)
- **Loot protection**: Only the killer can loot for 5 seconds, then it's free for all
- Items despawn after 60 seconds if not picked up
- Gold drops as visible 🪙 coins with quantity labels

### 13. 🔧 Quest System Fix — NPC Dialog & Markers
- **Fixed**: Merchant NPC now properly shows quest dialog (Dragon Slayer quest was inaccessible)
- **Fixed**: All NPCs send `npc_talk` for quest checking; merchant also opens shop
- **Server-driven quest markers**: `!` and `?` markers above NPCs now accurately reflect available/turn-in quests based on player level, prerequisites, and active quests
- Markers update in real-time when quests are accepted, completed, or turned in
- No more false `!` markers on NPCs with no available quests

### 12. 📜 Quest System
- **7 quests** across 5 NPCs with kill objectives and progression chains
  - **Elder Oak**: Slime Trouble (5 slimes) → Wolf Menace (3 wolves)
  - **Mira**: Goblin Raiders (4 goblins)
  - **Forge**: Undead Scourge (3 skeletons, rewards Iron Sword!)
  - **Pip**: Dragon Slayer (kill the dragon, rewards Fire Staff!)
  - **Old Gil**: Repeatable bounties (Slime Bounty, Wolf Bounty)
- Quest prerequisites unlock harder quests as you progress
- **Quest Tracker HUD** (top-left) shows active quest progress with bars
- **NPC Quest Markers**: Yellow `!` for available quests, `?` for turn-in
- **Quest Log** (press `Q` or tap 📜) — view progress, abandon quests
- Quest notifications for accept, progress, and completion
- Quest completions announced server-wide in kill feed
- Rewards: XP, gold, and item drops on turn-in
- Max 5 active quests at once

### 1. 🎒 Inventory UI + Shop Fix
- Press **I** (or tap 🎒 on mobile) to open inventory panel
- 5×4 grid layout with item icons, names, and stack counts
- Use buttons for consumables (potions)
- Removed duplicate "Mira's Shop" overlay — only Pip's Shop remains

### 2. 🗺️ Minimap
- Top-right corner minimap showing full world terrain
- Monster dots color-coded by type, blue for other players
- White pulsing dot for you, camera viewport rectangle
- Responsive sizing for mobile

### 3. 🌅 Day/Night Cycle
- 10-minute full day cycle: Dawn → Day → Dusk → Night
- Warm orange tint at dawn, red/purple at dusk, dark blue at night
- Time-of-day indicator in top-right

### 4. 💀 Death Animation
- Red flash burst, sprite fades to 15% over 1.5s
- Skull emoji tilts and falls downward

### 5. ⭐ Level-Up Particle Effects
- 30 golden particles burst outward, expanding ring animation
- "⭐ LEVEL X!" floating text

### 6. 👹 Goblins & Skeletons — New Monster Types
- **Goblins**: 80 HP, 15 ATK, 50 XP — 3 variants (normal, archer, shaman)
- **Skeletons**: 200 HP, 30 ATK, 120 XP — spawn at map edges
- Full combat, loot tables, minimap integration

### 7. 🎯 Target Info Frame
- Top-center HUD showing target name, HP bar, HP numbers
- Color-coded per monster type

### 8. 🔊 Ambient Forest Sounds
- Procedural wind noise + random bird chirps
- Starts on first click, respects mute toggle

### 9. 💥 Combat Hit Particles
- Color-coded particles burst on hit per monster type
- Damage numbers also colored by target

### 10. 📷 Camera Shake
- Screen shakes proportionally to damage taken
- 300ms smooth decay, capped intensity

### 11. 👣 Footstep Dust + Weapon Glow
- Sandy dust particles at feet while moving
- Weapon glow near player hand (fire=orange, bow=brown, sword=blue)
