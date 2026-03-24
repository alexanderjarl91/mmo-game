# 🎮 Creative Sprint Changelog

## Features Added

### 1. 🎒 Inventory UI + Shop Fix
- Press **I** (or tap 🎒 on mobile) to open inventory panel
- 5×4 grid layout with item icons, names, and stack counts
- Use buttons for consumables (potions)
- Removed duplicate "Mira's Shop" overlay — only Pip's Shop remains
- Purple-themed UI with hover effects

### 2. 🗺️ Minimap
- Top-right corner minimap showing full world terrain
- Color-coded tiles matching actual map (grass, water, trees, paths, temples)
- Monster dots: colored for slimes, red for wolves, green for goblins, white for skeletons
- Blue dots for other players, white pulsing dot for you
- Camera viewport rectangle overlay
- Responsive sizing for mobile

### 3. 🌅 Day/Night Cycle
- 10-minute full day cycle: Dawn → Day → Dusk → Night
- Warm orange tint at dawn, red/purple at dusk, dark blue at night
- Time-of-day indicator (🌅/☀️/🌇/🌙) in top-right
- Smooth transitions between all phases

### 4. 💀 Death Animation
- Red flash burst when player dies
- Sprite fades to 15% opacity over 1.5 seconds
- Skull emoji tilts and falls downward
- Smooth animation visible to all players

### 5. ⭐ Level-Up Particle Effects
- 30 golden particles burst outward on level up
- Expanding golden ring animation around player
- "⭐ LEVEL X!" text floats above player
- Particles have gravity, fade, and shrink over time

### 6. 👹 Goblins & Skeletons — New Monster Types
- **Goblins**: Green creatures with pointy ears (80 HP, 15 ATK, 50 XP)
  - 3 variants: Normal, Archer (bow), Shaman (staff + glow)
  - Spawn in outer grasslands, aggressive, fast movement
  - Drop iron weapons/armor and potions
- **Skeletons**: Bony undead figures (200 HP, 30 ATK, 120 XP)
  - Spawn at map edges (dangerous border zones)
  - Slow but deadly, wide 10-tile aggro range
  - Drop rare gear including Fire Staff
- Full combat integration, minimap dots, click-to-target

### 7. 🎯 Target Info Frame
- Centered top HUD showing current target details
- Name with color coding per monster type
- Dynamic HP bar (green → yellow → red)
- HP numbers below the bar
- Red-bordered frame for clear visual
