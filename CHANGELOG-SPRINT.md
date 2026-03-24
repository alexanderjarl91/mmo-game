# 🎮 Creative Sprint Changelog

## Features Added

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
