# 🎮 Creative Sprint Changelog

## Features Added

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
