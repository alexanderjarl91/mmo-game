import { Schema, type } from "@colyseus/schema";

export class QuestSlot extends Schema {
  @type("string") questId: string = "";
  @type("number") progress: number = 0;   // current kill/collect count
  @type("number") required: number = 0;    // target count
  @type("boolean") completed: boolean = false; // ready to turn in
  @type("boolean") turnedIn: boolean = false;  // already claimed reward
}
