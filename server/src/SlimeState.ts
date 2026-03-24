import { Schema, type } from "@colyseus/schema";

export class SlimeState extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 50;
  @type("number") maxHp: number = 50;
  @type("string") color: string = "#2ecc71";
  @type("string") size: string = "normal"; // small, normal, big
  @type("boolean") alive: boolean = true;
  @type("string") targetPlayerId: string = ""; // aggro target (empty = neutral)
  @type("number") frostedUntil: number = 0;
}
