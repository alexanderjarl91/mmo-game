import { useState } from "react";
import LoginScreen from "./components/LoginScreen";
import GameCanvas from "./components/GameCanvas";

export default function App() {
  const [player, setPlayer] = useState<{ name: string; playerClass: string; isHardcore: boolean } | null>(null);

  if (!player) {
    return <LoginScreen onPlay={(name, playerClass, isHardcore) => setPlayer({ name, playerClass, isHardcore })} />;
  }

  return <GameCanvas playerName={player.name} playerClass={player.playerClass} isHardcore={player.isHardcore} />;
}
