# Creative Sprint Changelog 🎮

**Branch:** `feature/creative-sprint`
**Started:** 2026-03-23 ~23:30 UTC
**Status:** In Progress

Alex — read this in the morning to see what got built overnight.

---

## Features Added

### 1. 🎒 Inventory UI + Shop Fix
- Press **I** (or tap 🎒 on mobile) to open inventory panel
- 5×4 grid layout with item icons, names, and stack counts
- Use buttons for consumables (potions)
- Removed duplicate "Mira's Shop" overlay — only Pip's Shop remains
- Purple-themed UI with hover effects

### 2. 🗺️ Minimap
- Minimap with terrain colors, monster dots, player dots, and viewport indicator
- Shows the full map in miniature in the corner

### 3. 🌙 Day/Night Cycle
- 10-minute full cycle: dawn → day → dusk → night
- Subtle overlay effects (toned down 60% per Alex's request)

### 4. 💀 Death Animation
- Fade out, red flash, and tilt effect on death

### 5. ✨ Level-up Effects
- Particle burst and golden ring animation on level up

### 6. ⚔️ Equipment System
- Weapons and armor drop from monsters
- Equip slots (weapon, helmet, chest, legs)
- Stat bonuses (ATK, DEF) from gear
- Defense stat reduces incoming damage

### 7. 👹 New Monster Types
- **Goblins** — new mid-tier enemy
- **Skeletons** — tougher enemy type
- Power Shot works on all monster types

### 8. 🔊 Sound Effects
- Procedural audio via Web Audio API (hits, spells, ambient)
