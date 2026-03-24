import { Schema, type } from "@colyseus/schema";

export class WorldEventState extends Schema {
  @type("string") id: string = "";
  @type("string") eventType: string = ""; // "treasure_chest" | "mana_shrine" | "golden_slime" | "xp_orb"
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") spawnedAt: number = 0;
  @type("number") expiresAt: number = 0;
  @type("boolean") active: boolean = true;
  // For golden slime: track HP
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
  @type("string") targetPlayerId: string = ""; // golden slime aggro
}
