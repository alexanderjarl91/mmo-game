import { Schema, type } from "@colyseus/schema";

export class BossState extends Schema {
  @type("string") id: string = "";
  @type("string") bossType: string = "dragon"; // dragon, demon, etc
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 2000;
  @type("number") maxHp: number = 2000;
  @type("boolean") alive: boolean = false; // starts dead, spawns periodically
  @type("string") targetPlayerId: string = "";
  @type("number") phase: number = 1; // boss phase (changes behavior at low HP)
  spawnX: number = 0;
  spawnY: number = 0;
}
