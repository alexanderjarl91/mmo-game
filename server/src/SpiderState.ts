import { Schema, type } from "@colyseus/schema";

export class SpiderState extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
  @type("string") spiderType: string = ""; // "baby", "cave", "poison", "elite", "queen", "brood"
  @type("boolean") alive: boolean = true;
  @type("string") targetPlayerId: string = "";
  @type("number") frostedUntil: number = 0;
  @type("number") phase: number = 1; // for queen only
  spawnX: number = 0;
  spawnY: number = 0;
  isBrood: boolean = false; // brood spiders die with boss
}
