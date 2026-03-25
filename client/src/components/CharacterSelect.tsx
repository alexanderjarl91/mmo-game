import { useState, useEffect, useCallback } from "react";

interface CharacterSummary {
  id: number;
  name: string;
  class: string;
  level: number;
  isHardcore: boolean;
}

interface Props {
  token: string;
  onSelectCharacter: (charId: number) => void;
  onLogout: () => void;
}

const API_BASE = `${window.location.protocol}//${window.location.host}`;
const MAX_CHARACTERS = 10;

const classInfo: Record<string, { icon: string; name: string; color: string; desc: string; stats: string }> = {
  warrior: { icon: "⚔️", name: "Warrior", color: "#e74c3c", desc: "Tank. High HP & Defense.", stats: "HP: 130 | ATK: 22 | DEF: 8" },
  ranger: { icon: "🏹", name: "Ranger", color: "#2ecc71", desc: "Ranged DPS. Strikes from distance.", stats: "HP: 85 | ATK: 20 | Range: 4" },
  mage: { icon: "🔮", name: "Mage", color: "#9b59b6", desc: "Spell Caster. Huge MP pool.", stats: "HP: 70 | ATK: 10 | MP: 100" },
  rogue: { icon: "🗡️", name: "Rogue", color: "#f39c12", desc: "Melee DPS. Fast attacks. High crit.", stats: "HP: 80 | ATK: 18 | Crit: 10%" },
};

export default function CharacterSelect({ token, onSelectCharacter, onLogout }: Props) {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newClass, setNewClass] = useState<string>("warrior");
  const [newHardcore, setNewHardcore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/characters`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401) { onLogout(); return; }
        throw new Error("Failed to load characters");
      }
      const data = await res.json();
      setCharacters(data.characters);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => { fetchCharacters(); }, [fetchCharacters]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim(), playerClass: newClass, isHardcore: newHardcore }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create character");
      setShowCreate(false);
      setNewName("");
      setNewClass("warrior");
      setNewHardcore(false);
      await fetchCharacters();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (charId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/characters/${charId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      setDeleteConfirm(null);
      await fetchCharacters();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🌍</div>
        <div style={{ fontSize: 18 }}>Loading characters...</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: 40, marginBottom: 4, letterSpacing: 2 }}>🌍 MMO World</h1>
      <p style={{ color: "#aaa", marginBottom: 28, fontSize: 15 }}>Select a character or create a new one</p>

      {error && (
        <div style={{ color: "#e74c3c", marginBottom: 16, padding: "8px 16px", background: "rgba(231,76,60,0.15)", borderRadius: 8, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Character list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 420, marginBottom: 20 }}>
        {characters.map((char) => {
          const info = classInfo[char.class] || classInfo.warrior;
          const isDeleting = deleteConfirm === char.id;
          return (
            <div key={char.id} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 18px", borderRadius: 12,
              border: `2px solid ${info.color}44`,
              background: "rgba(255,255,255,0.06)",
              cursor: isDeleting ? "default" : "pointer",
              transition: "all 0.15s",
            }}
              onClick={() => !isDeleting && onSelectCharacter(char.id)}
              onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.borderColor = info.color; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${info.color}44`; }}
            >
              <div style={{ fontSize: 36, flexShrink: 0 }}>{info.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: "bold", display: "flex", alignItems: "center", gap: 8 }}>
                  {char.name}
                  {char.isHardcore && <span style={{ color: "#ff4444", fontSize: 14 }}>☠️ HC</span>}
                </div>
                <div style={{ fontSize: 13, color: "#aaa" }}>
                  {info.name} — Level {char.level}
                </div>
              </div>
              {isDeleting ? (
                <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleDelete(char.id)} style={deleteBtnStyle}>Yes</button>
                  <button onClick={() => setDeleteConfirm(null)} style={{ ...deleteBtnStyle, background: "#555" }}>No</button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(char.id); }}
                  style={{ background: "none", border: "none", color: "#666", fontSize: 16, cursor: "pointer", padding: "4px 8px" }}
                  title="Delete character"
                >🗑️</button>
              )}
            </div>
          );
        })}

        {characters.length === 0 && !showCreate && (
          <div style={{ textAlign: "center", color: "#888", padding: 32 }}>
            No characters yet. Create your first one!
          </div>
        )}
      </div>

      {/* Create new character */}
      {showCreate ? (
        <div style={{ width: "100%", maxWidth: 420, padding: 20, borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Create Character</h3>

          {/* Class picker */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {(["warrior", "ranger", "mage", "rogue"] as const).map((cls) => {
              const info = classInfo[cls];
              const selected = newClass === cls;
              return (
                <div
                  key={cls}
                  onClick={() => setNewClass(cls)}
                  style={{
                    padding: 12, borderRadius: 10, textAlign: "center", cursor: "pointer",
                    border: `2px solid ${selected ? info.color : "rgba(255,255,255,0.1)"}`,
                    background: selected ? `${info.color}18` : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: 28 }}>{info.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: "bold", color: selected ? info.color : "#fff", marginTop: 4 }}>{info.name}</div>
                  <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{info.stats}</div>
                </div>
              );
            })}
          </div>

          {/* Hardcore toggle */}
          <div
            onClick={() => setNewHardcore(!newHardcore)}
            style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
              cursor: "pointer", userSelect: "none", padding: "8px 12px", borderRadius: 8,
              border: `2px solid ${newHardcore ? "#ff4444" : "rgba(255,255,255,0.1)"}`,
              background: newHardcore ? "rgba(255,68,68,0.12)" : "transparent",
              transition: "all 0.15s",
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: 4,
              border: `2px solid ${newHardcore ? "#ff4444" : "#555"}`,
              background: newHardcore ? "#ff4444" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: "#fff",
            }}>
              {newHardcore ? "✓" : ""}
            </div>
            <div>
              <span style={{ fontWeight: "bold", color: newHardcore ? "#ff4444" : "#fff", fontSize: 14 }}>
                ☠️ Hardcore Mode
              </span>
              <div style={{ fontSize: 11, color: "#888" }}>Death is permanent</div>
            </div>
          </div>

          {/* Name + submit */}
          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Character name..."
              maxLength={20}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) handleCreate(); }}
              style={{
                flex: 1, padding: "10px 14px", fontSize: 15, borderRadius: 8,
                border: `2px solid ${classInfo[newClass].color}`, background: "rgba(255,255,255,0.08)",
                color: "#fff", outline: "none",
              }}
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              style={{
                padding: "10px 20px", fontSize: 15, borderRadius: 8, border: "none", fontWeight: "bold",
                background: newName.trim() && !creating ? classInfo[newClass].color : "#555",
                color: "#fff", cursor: newName.trim() && !creating ? "pointer" : "default",
              }}
            >
              {creating ? "..." : "Create"}
            </button>
          </div>

          <button onClick={() => { setShowCreate(false); setError(""); }} style={{ marginTop: 12, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13 }}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          disabled={characters.length >= MAX_CHARACTERS}
          style={{
            padding: "12px 32px", fontSize: 16, borderRadius: 8, border: "2px solid rgba(255,255,255,0.2)",
            background: characters.length >= MAX_CHARACTERS ? "#333" : "rgba(255,255,255,0.08)",
            color: characters.length >= MAX_CHARACTERS ? "#666" : "#fff",
            cursor: characters.length >= MAX_CHARACTERS ? "default" : "pointer",
            fontWeight: "bold", marginBottom: 12,
          }}
        >
          {characters.length >= MAX_CHARACTERS ? `Max Characters (${MAX_CHARACTERS})` : "+ New Character"}
        </button>
      )}

      {/* Logout */}
      <button
        onClick={onLogout}
        style={{ marginTop: 16, background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 13 }}
      >
        Log Out
      </button>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  width: "100%", height: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
  color: "#fff", padding: 20, overflowY: "auto",
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "4px 12px", fontSize: 12, borderRadius: 6, border: "none",
  background: "#e74c3c", color: "#fff", cursor: "pointer", fontWeight: "bold",
};
