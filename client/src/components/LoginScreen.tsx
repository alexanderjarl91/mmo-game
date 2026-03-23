import { useState, useEffect } from "react";

interface Props {
  onPlay: (name: string, playerClass: string, isHardcore: boolean) => void;
}

interface SavedCharacter {
  name: string;
  playerClass: string;
  level: number;
  xp: number;
  savedAt: number;
  isHardcore?: boolean;
}

function getSavedCharacter(): SavedCharacter | null {
  try {
    const raw = localStorage.getItem("mmo_character");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export default function LoginScreen({ onPlay }: Props) {
  const [saved, setSaved] = useState<SavedCharacter | null>(null);
  const [name, setName] = useState("");
  const [playerClass, setPlayerClass] = useState<"warrior" | "ranger">("warrior");
  const [showNew, setShowNew] = useState(false);
  const [isHardcore, setIsHardcore] = useState(false);

  useEffect(() => {
    const s = getSavedCharacter();
    if (s) {
      setSaved(s);
      setName(s.name);
      setPlayerClass(s.playerClass as "warrior" | "ranger");
    } else {
      setShowNew(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onPlay(trimmed, playerClass, isHardcore);
  };

  const handleContinue = () => {
    if (saved) onPlay(saved.name, saved.playerClass, saved.isHardcore || false);
  };

  const handleNewCharacter = () => {
    setShowNew(true);
    setSaved(null);
    setName("");
    setPlayerClass("warrior");
  };

  const classInfo = {
    warrior: {
      icon: "⚔️",
      name: "Warrior",
      desc: "Melee fighter. Must be adjacent to attack. High HP & damage.",
      stats: "HP: 120 | ATK: 30 | Range: 1",
      color: "#e74c3c",
    },
    ranger: {
      icon: "🏹",
      name: "Ranger",
      desc: "Ranged attacker. Shoots arrows from distance. Lower HP.",
      stats: "HP: 80 | ATK: 20 | Range: 4",
      color: "#2ecc71",
    },
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        color: "#fff",
        padding: 20,
      }}
    >
      <h1 style={{ fontSize: 48, marginBottom: 8, letterSpacing: 2 }}>🌍 MMO World</h1>
      <p style={{ color: "#aaa", marginBottom: 24, fontSize: 16 }}>
        Choose your class and enter the world
      </p>

      {/* Continue saved character */}
      {saved && !showNew && (
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            padding: 24,
            borderRadius: 12,
            border: `3px solid ${classInfo[saved.playerClass as keyof typeof classInfo]?.color || "#fff"}`,
            background: "rgba(255,255,255,0.08)",
            marginBottom: 16,
            minWidth: 280,
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>
              {classInfo[saved.playerClass as keyof typeof classInfo]?.icon || "⚔️"}
            </div>
            <div style={{ fontSize: 22, fontWeight: "bold", marginBottom: 4 }}>{saved.name}</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 4 }}>
              {classInfo[saved.playerClass as keyof typeof classInfo]?.name || saved.playerClass} — Level {saved.level}
              {saved.isHardcore && <span style={{ color: "#ff4444", marginLeft: 8 }}>☠️ HC</span>}
            </div>
            <div style={{ fontSize: 12, color: "#888", fontFamily: "monospace" }}>
              XP: {saved.xp}
            </div>
          </div>
          <button
            onClick={handleContinue}
            style={{
              padding: "14px 48px",
              fontSize: 20,
              borderRadius: 8,
              border: "none",
              background: classInfo[saved.playerClass as keyof typeof classInfo]?.color || "#3498db",
              color: "#fff",
              cursor: "pointer",
              fontWeight: "bold",
              marginBottom: 12,
              display: "block",
              width: "100%",
            }}
          >
            Continue
          </button>
          <button
            onClick={handleNewCharacter}
            style={{
              padding: "10px 32px",
              fontSize: 14,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "#aaa",
              cursor: "pointer",
              width: "100%",
            }}
          >
            New Character
          </button>
        </div>
      )}

      {/* New character creation */}
      {(showNew || !saved) && (
        <>
          {/* Class selection */}
          <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap", justifyContent: "center" }}>
            {(["warrior", "ranger"] as const).map((cls) => {
              const info = classInfo[cls];
              const selected = playerClass === cls;
              return (
                <div
                  key={cls}
                  onClick={() => setPlayerClass(cls)}
                  style={{
                    width: 180,
                    padding: 16,
                    borderRadius: 12,
                    border: `3px solid ${selected ? info.color : "rgba(255,255,255,0.15)"}`,
                    background: selected ? `${info.color}22` : "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 36, marginBottom: 8 }}>{info.icon}</div>
                  <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 6, color: selected ? info.color : "#fff" }}>
                    {info.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8, lineHeight: 1.4 }}>{info.desc}</div>
                  <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>{info.stats}</div>
                </div>
              );
            })}
          </div>

          {/* Game mode toggle */}
          <div
            onClick={() => setIsHardcore(!isHardcore)}
            style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 20,
              cursor: "pointer", userSelect: "none",
              padding: "8px 16px", borderRadius: 8,
              border: `2px solid ${isHardcore ? "#ff4444" : "rgba(255,255,255,0.15)"}`,
              background: isHardcore ? "rgba(255,68,68,0.15)" : "rgba(255,255,255,0.05)",
              transition: "all 0.2s",
            }}
          >
            <div style={{
              width: 20, height: 20, borderRadius: 4,
              border: `2px solid ${isHardcore ? "#ff4444" : "#666"}`,
              background: isHardcore ? "#ff4444" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, color: "#fff",
            }}>
              {isHardcore ? "✓" : ""}
            </div>
            <div>
              <span style={{ fontWeight: "bold", color: isHardcore ? "#ff4444" : "#fff" }}>
                ☠️ Hardcore Mode
              </span>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                Death is permanent. Character deleted on death.
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name..."
              maxLength={20}
              autoFocus
              style={{
                padding: "12px 20px",
                fontSize: 18,
                borderRadius: 8,
                border: `2px solid ${classInfo[playerClass].color}`,
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                outline: "none",
                width: 220,
              }}
            />
            <button
              type="submit"
              disabled={!name.trim()}
              style={{
                padding: "12px 32px",
                fontSize: 18,
                borderRadius: 8,
                border: "none",
                background: name.trim() ? classInfo[playerClass].color : "#555",
                color: "#fff",
                cursor: name.trim() ? "pointer" : "default",
                fontWeight: "bold",
                transition: "background 0.2s",
              }}
            >
              Play
            </button>
          </form>
        </>
      )}
    </div>
  );
}
