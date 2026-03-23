import { Schema, type } from "@colyseus/schema";

export class GoblinState extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 80;
  @type("number") maxHp: number = 80;
  @type("boolean") alive: boolean = true;
  @type("string") targetPlayerId: string = "";
  @type("string") variant: string = "normal"; // normal, archer, shaman
  spawnX: number = 0;
  spawnY: number = 0;
}
