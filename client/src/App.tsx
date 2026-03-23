import { useState } from "react";
import LoginScreen from "./components/LoginScreen";
import GameCanvas from "./components/GameCanvas";

export default function App() {
  const [player, setPlayer] = useState<{ name: string; playerClass: string } | null>(null);

  if (!player) {
    return <LoginScreen onPlay={(name, playerClass) => setPlayer({ name, playerClass })} />;
  }

  return <GameCanvas playerName={player.name} playerClass={player.playerClass} />;
}
