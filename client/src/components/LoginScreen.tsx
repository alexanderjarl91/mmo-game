import { useState } from "react";

interface Props {
  onPlay: (name: string, playerClass: string) => void;
}

export default function LoginScreen({ onPlay }: Props) {
  const [name, setName] = useState("");
  const [playerClass, setPlayerClass] = useState<"warrior" | "ranger">("warrior");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onPlay(trimmed, playerClass);
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
      stats: "HP: 80 | ATK: 20 | Range: 3",
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
    </div>
  );
}
