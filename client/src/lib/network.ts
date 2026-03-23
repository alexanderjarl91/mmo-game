import { Client, Room } from "colyseus.js";

const SERVER_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

let client: Client;
let room: Room | null = null;

export function getClient(): Client {
  if (!client) {
    client = new Client(SERVER_URL);
  }
  return client;
}

export async function joinGame(name: string, playerClass: string, isHardcore: boolean = false): Promise<Room> {
  const c = getClient();
  // Load saved character data
  let savedXp = 0;
  try {
    const raw = localStorage.getItem("mmo_character");
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.name === name && saved.playerClass === playerClass) {
        savedXp = saved.xp || 0;
      }
    }
  } catch {}
  try {
    room = await c.joinOrCreate("game", { name, playerClass, savedXp, isHardcore });
    return room;
  } catch (err: any) {
    console.error("Join failed:", err);
    throw new Error(err?.message || "Could not connect to game server");
  }
}

export function getRoom(): Room | null {
  return room;
}

export function sendMove(dx: number, dy: number) {
  if (room) room.send("move", { dx, dy });
}

export function sendStop() {
  if (room) room.send("stop", {});
}

export function sendSetTarget(targetId: string) {
  if (room) room.send("set_target", { targetId });
}

export function sendClearTarget() {
  if (room) room.send("clear_target", {});
}
