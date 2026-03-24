import { Schema, type } from "@colyseus/schema";

export class DroppedItem extends Schema {
  @type("string") id: string = "";
  @type("string") itemId: string = "";
  @type("number") quantity: number = 1;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") droppedAt: number = 0; // timestamp
  @type("string") ownerSessionId: string = ""; // who can loot (empty = anyone after delay)
}
