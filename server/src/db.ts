import Database, { type Database as DatabaseType } from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "game.db");

const db: DatabaseType = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema — Base tables (CREATE IF NOT EXISTS = safe to re-run) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    reset_token TEXT,
    reset_token_expires INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    class TEXT NOT NULL CHECK(class IN ('warrior','ranger','mage','rogue')),
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    gold INTEGER DEFAULT 0,
    hp INTEGER DEFAULT 100,
    max_hp INTEGER DEFAULT 100,
    mp INTEGER DEFAULT 50,
    max_mp INTEGER DEFAULT 50,
    attack INTEGER DEFAULT 25,
    defense INTEGER DEFAULT 0,
    crit_chance INTEGER DEFAULT 0,
    dodge_chance INTEGER DEFAULT 0,
    mp_regen INTEGER DEFAULT 0,
    attack_interval INTEGER DEFAULT 1000,
    equip_weapon TEXT DEFAULT '',
    equip_helmet TEXT DEFAULT '',
    equip_chest TEXT DEFAULT '',
    equip_legs TEXT DEFAULT '',
    equip_boots TEXT DEFAULT '',
    inventory TEXT DEFAULT '[]',
    completed_quests TEXT DEFAULT '[]',
    x REAL DEFAULT 36,
    y REAL DEFAULT 37,
    is_hardcore INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
`);

// ── Migrations — Additive column changes (safe to re-run) ──
// Helper: check if a column exists before adding it
function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[DB Migration] Added ${table}.${column}`);
  }
}

// Migration 1: Active quests persistence
addColumnIfMissing("characters", "active_quests", "TEXT DEFAULT '[]'");

// Migration 2: Skill system
addColumnIfMissing("characters", "melee_skill", "INTEGER DEFAULT 1");
addColumnIfMissing("characters", "melee_tries", "REAL DEFAULT 0");
addColumnIfMissing("characters", "ranged_skill", "INTEGER DEFAULT 1");
addColumnIfMissing("characters", "ranged_tries", "REAL DEFAULT 0");
addColumnIfMissing("characters", "magic_skill", "INTEGER DEFAULT 1");
addColumnIfMissing("characters", "magic_tries", "REAL DEFAULT 0");
addColumnIfMissing("characters", "shielding_skill", "INTEGER DEFAULT 1");
addColumnIfMissing("characters", "shielding_tries", "REAL DEFAULT 0");

// Future migrations go here — just add more addColumnIfMissing() calls
// NEVER delete game.db to add columns — always migrate!

// ── Types ──
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  reset_token: string | null;
  reset_token_expires: number | null;
  created_at: number;
}

export interface CharacterRow {
  id: number;
  user_id: number;
  name: string;
  class: string;
  level: number;
  xp: number;
  gold: number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  attack: number;
  defense: number;
  crit_chance: number;
  dodge_chance: number;
  mp_regen: number;
  attack_interval: number;
  equip_weapon: string;
  equip_helmet: string;
  equip_chest: string;
  equip_legs: string;
  equip_boots: string;
  inventory: string;
  completed_quests: string;
  active_quests: string;
  x: number;
  y: number;
  is_hardcore: number;
  melee_skill: number;
  melee_tries: number;
  ranged_skill: number;
  ranged_tries: number;
  magic_skill: number;
  magic_tries: number;
  shielding_skill: number;
  shielding_tries: number;
  created_at: number;
  updated_at: number;
}

// ── Prepared statements ──
const stmtCreateUser = db.prepare(
  "INSERT INTO users (email, password_hash) VALUES (?, ?)"
);

const stmtGetUserByEmail = db.prepare(
  "SELECT * FROM users WHERE email = ?"
);

const stmtGetUserById = db.prepare(
  "SELECT * FROM users WHERE id = ?"
);

const stmtUpdateUserPassword = db.prepare(
  "UPDATE users SET password_hash = ? WHERE id = ?"
);

const stmtSetResetToken = db.prepare(
  "UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?"
);

const stmtClearResetToken = db.prepare(
  "UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?"
);

const stmtCreateCharacter = db.prepare(`
  INSERT INTO characters (user_id, name, class, is_hardcore)
  VALUES (?, ?, ?, ?)
`);

const stmtGetCharactersByUserId = db.prepare(
  "SELECT * FROM characters WHERE user_id = ? ORDER BY created_at ASC"
);

const stmtGetCharacterById = db.prepare(
  "SELECT * FROM characters WHERE id = ?"
);

const stmtCountCharactersByUserId = db.prepare(
  "SELECT COUNT(*) as count FROM characters WHERE user_id = ?"
);

const stmtGetCharacterByName = db.prepare(
  "SELECT * FROM characters WHERE name = ?"
);

const stmtSaveCharacter = db.prepare(`
  UPDATE characters SET
    level = ?, xp = ?, gold = ?,
    hp = ?, max_hp = ?, mp = ?, max_mp = ?,
    attack = ?, defense = ?,
    crit_chance = ?, dodge_chance = ?,
    mp_regen = ?, attack_interval = ?,
    equip_weapon = ?, equip_helmet = ?,
    equip_chest = ?, equip_legs = ?, equip_boots = ?,
    inventory = ?, completed_quests = ?, active_quests = ?,
    x = ?, y = ?,
    melee_skill = ?, melee_tries = ?,
    ranged_skill = ?, ranged_tries = ?,
    magic_skill = ?, magic_tries = ?,
    shielding_skill = ?, shielding_tries = ?,
    updated_at = unixepoch()
  WHERE id = ?
`);

const stmtDeleteCharacter = db.prepare(
  "DELETE FROM characters WHERE id = ?"
);

// ── Exported helpers ──

export function createUser(email: string, passwordHash: string): number {
  const result = stmtCreateUser.run(email, passwordHash);
  return result.lastInsertRowid as number;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return stmtGetUserByEmail.get(email) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return stmtGetUserById.get(id) as UserRow | undefined;
}

export function updateUserPassword(userId: number, passwordHash: string): void {
  stmtUpdateUserPassword.run(passwordHash, userId);
}

export function setResetToken(userId: number, tokenHash: string, expiresAt: number): void {
  stmtSetResetToken.run(tokenHash, expiresAt, userId);
}

export function clearResetToken(userId: number): void {
  stmtClearResetToken.run(userId);
}

export function createCharacter(userId: number, name: string, charClass: string, isHardcore: boolean): number {
  const result = stmtCreateCharacter.run(userId, name, charClass, isHardcore ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function getCharactersByUserId(userId: number): CharacterRow[] {
  return stmtGetCharactersByUserId.all(userId) as CharacterRow[];
}

export function getCharacterById(id: number): CharacterRow | undefined {
  return stmtGetCharacterById.get(id) as CharacterRow | undefined;
}

export function countCharactersByUserId(userId: number): number {
  const row = stmtCountCharactersByUserId.get(userId) as { count: number };
  return row.count;
}

export function getCharacterByName(name: string): CharacterRow | undefined {
  return stmtGetCharacterByName.get(name) as CharacterRow | undefined;
}

export function loadCharacter(characterId: number): CharacterRow | undefined {
  return stmtGetCharacterById.get(characterId) as CharacterRow | undefined;
}

export function saveCharacter(
  characterId: number,
  data: {
    level: number; xp: number; gold: number;
    hp: number; maxHp: number; mp: number; maxMp: number;
    attack: number; defense: number;
    critChance: number; dodgeChance: number;
    mpRegen: number; attackInterval: number;
    equipWeapon: string; equipHelmet: string;
    equipChest: string; equipLegs: string; equipBoots: string;
    inventory: string; completedQuests: string; activeQuests: string;
    x: number; y: number;
    meleeSkill: number; meleeTries: number;
    rangedSkill: number; rangedTries: number;
    magicSkill: number; magicTries: number;
    shieldingSkill: number; shieldingTries: number;
  }
): void {
  stmtSaveCharacter.run(
    data.level, data.xp, data.gold,
    data.hp, data.maxHp, data.mp, data.maxMp,
    data.attack, data.defense,
    data.critChance, data.dodgeChance,
    data.mpRegen, data.attackInterval,
    data.equipWeapon, data.equipHelmet,
    data.equipChest, data.equipLegs, data.equipBoots,
    data.inventory, data.completedQuests, data.activeQuests,
    data.x, data.y,
    data.meleeSkill, data.meleeTries,
    data.rangedSkill, data.rangedTries,
    data.magicSkill, data.magicTries,
    data.shieldingSkill, data.shieldingTries,
    characterId
  );
}

export function deleteCharacter(characterId: number): void {
  stmtDeleteCharacter.run(characterId);
}

/** Batch save multiple characters in a single transaction */
export const batchSaveCharacters: (entries: Array<{ characterId: number; data: Parameters<typeof saveCharacter>[1] }>) => void = db.transaction(
  (entries: Array<{ characterId: number; data: Parameters<typeof saveCharacter>[1] }>) => {
    for (const entry of entries) {
      saveCharacter(entry.characterId, entry.data);
    }
  }
);

export default db;
