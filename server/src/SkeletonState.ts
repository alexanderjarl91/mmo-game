import { Schema, type } from "@colyseus/schema";

export class SkeletonState extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 120;
  @type("number") maxHp: number = 120;
  @type("boolean") alive: boolean = true;
  @type("string") targetPlayerId: string = "";
  spawnX: number = 0;
  spawnY: number = 0;
}
