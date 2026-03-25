import { useState, useEffect } from "react";
import LoginScreen from "./components/LoginScreen";
import CharacterSelect from "./components/CharacterSelect";
import GameCanvas from "./components/GameCanvas";

type Screen = "login" | "characterSelect" | "game";

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [token, setToken] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<number | null>(null);

  // Check for existing token on mount
  useEffect(() => {
    const saved = localStorage.getItem("mmo_token");
    if (saved) {
      setToken(saved);
      setScreen("characterSelect");
    }
  }, []);

  const handleLogin = (t: string) => {
    localStorage.setItem("mmo_token", t);
    setToken(t);
    setScreen("characterSelect");
  };

  const handleSelectCharacter = (charId: number) => {
    setCharacterId(charId);
    setScreen("game");
  };

  const handleBackToSelect = () => {
    setCharacterId(null);
    setScreen("characterSelect");
  };

  const handleLogout = () => {
    localStorage.removeItem("mmo_token");
    setToken(null);
    setCharacterId(null);
    setScreen("login");
  };

  if (screen === "login" || !token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (screen === "characterSelect" || !characterId) {
    return (
      <CharacterSelect
        token={token}
        onSelectCharacter={handleSelectCharacter}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <GameCanvas
      token={token}
      characterId={characterId}
      onLogout={handleLogout}
      onBackToSelect={handleBackToSelect}
    />
  );
}
