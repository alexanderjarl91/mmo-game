import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { GameRoom } from "./GameRoom";

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

const PORT = 2567;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🎮 Game server running on http://localhost:${PORT}`);
});
