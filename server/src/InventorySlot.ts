import { Schema, type } from "@colyseus/schema";

export class InventorySlot extends Schema {
  @type("string") itemId: string = "";
  @type("number") quantity: number = 0;
}
