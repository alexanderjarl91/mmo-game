import { Schema, ArraySchema, type } from "@colyseus/schema";
import { InventorySlot } from "./InventorySlot";
import { QuestSlot } from "./QuestSlot";

export class PlayerState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") color: string = "#ffffff";
  @type("string") name: string = "";
  @type("string") direction: string = "down";
  @type("boolean") moving: boolean = false;
  @type("number") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("number") xp: number = 0;
  @type("number") level: number = 1;
  @type("number") attack: number = 25;
  @type("number") mp: number = 50;
  @type("number") maxMp: number = 50;
  @type("string") playerClass: string = "warrior"; // warrior | ranger
  @type("string") targetId: string = ""; // current attack target (slime id or player session id)
  @type("boolean") isHardcore: boolean = false;
  @type("number") gold: number = 0;
  @type([InventorySlot]) inventory = new ArraySchema<InventorySlot>();
  // Equipment slots (item IDs, empty string = nothing equipped)
  @type("string") equipWeapon: string = "";
  @type("string") equipHelmet: string = "";
  @type("string") equipChest: string = "";
  @type("string") equipLegs: string = "";
  @type("string") equipBoots: string = "";
  @type("number") defense: number = 0; // total defense from equipment
  // Status effects (synced to client for visuals)
  @type("string") statusEffect: string = ""; // "poison" | "burn" | "" 
  @type("number") statusEffectEnd: number = 0; // server timestamp when effect expires
  // Buff system (synced to client for visuals)
  @type("number") buffShieldWallEnd: number = 0; // timestamp when Shield Wall expires
  @type("number") buffWarCryEnd: number = 0; // timestamp when War Cry expires
  @type("number") buffWarCryAtk: number = 0; // bonus attack from War Cry
  // Quest system
  @type([QuestSlot]) quests = new ArraySchema<QuestSlot>();
  completedQuestIds: Set<string> = new Set(); // not synced via schema, tracked server-side
}
