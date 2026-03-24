import { Schema, type } from "@colyseus/schema";

export class WolfState extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 150;
  @type("number") maxHp: number = 150;
  @type("boolean") alive: boolean = true;
  @type("string") targetPlayerId: string = ""; // who it's chasing
  @type("number") frostedUntil: number = 0; // timestamp when frost slow expires
  spawnX: number = 0; // not synced to client
  spawnY: number = 0;
}
