// Static item catalog. The DB stores ItemStack rows that reference a `defKey`
// here. Resource-type items convert into shelter resource counters on deposit.

export type ResourceKey = "food" | "water" | "meds" | "ammo" | "scrap" | "fuel";

export type ItemCategory =
  | "WEAPON"
  | "ARMOR"
  | "CONSUMABLE"
  | "RESOURCE"
  | "MATERIAL";

export type EquipSlot = "PRIMARY" | "SECONDARY" | "ARMOR" | "HELMET" | "BACKPACK";

export interface ItemDef {
  key: string;
  name: string;
  icon: string;
  category: ItemCategory;
  tier: number; // 1..5, gates where it appears as loot (≈ distance)
  stackable: boolean;
  slot?: EquipSlot;
  // Weapons
  damage?: number;
  accuracy?: number; // 0..1
  maxDurability?: number;
  usesAmmo?: boolean;
  // Armor
  armor?: number;
  // Consumables (applied on use)
  heal?: number;
  reduceRad?: number;
  restoreStamina?: number;
  // Resource items deposit into a shelter counter on return.
  resource?: ResourceKey;
  resourceAmount?: number;
  // Backpack capacity bonus when equipped
  carryBonus?: number;
}

export const ITEM_DEFS: Record<string, ItemDef> = {
  // ── Weapons ──────────────────────────────────────────────────────────────
  fists: { key: "fists", name: "Bare Hands", icon: "✊", category: "WEAPON", tier: 1, stackable: false, slot: "PRIMARY", damage: 6, accuracy: 0.8 },
  knife: { key: "knife", name: "Combat Knife", icon: "🔪", category: "WEAPON", tier: 1, stackable: false, slot: "SECONDARY", damage: 12, accuracy: 0.85, maxDurability: 60 },
  bat: { key: "bat", name: "Nail Bat", icon: "🏏", category: "WEAPON", tier: 1, stackable: false, slot: "PRIMARY", damage: 16, accuracy: 0.75, maxDurability: 50 },
  pistol: { key: "pistol", name: "9mm Pistol", icon: "🔫", category: "WEAPON", tier: 2, stackable: false, slot: "PRIMARY", damage: 24, accuracy: 0.8, maxDurability: 80, usesAmmo: true },
  shotgun: { key: "shotgun", name: "Pump Shotgun", icon: "💥", category: "WEAPON", tier: 3, stackable: false, slot: "PRIMARY", damage: 42, accuracy: 0.65, maxDurability: 70, usesAmmo: true },
  rifle: { key: "rifle", name: "Hunting Rifle", icon: "🎯", category: "WEAPON", tier: 4, stackable: false, slot: "PRIMARY", damage: 55, accuracy: 0.9, maxDurability: 90, usesAmmo: true },

  // ── Armor ────────────────────────────────────────────────────────────────
  jacket: { key: "jacket", name: "Leather Jacket", icon: "🧥", category: "ARMOR", tier: 1, stackable: false, slot: "ARMOR", armor: 8, maxDurability: 60 },
  vest: { key: "vest", name: "Kevlar Vest", icon: "🦺", category: "ARMOR", tier: 3, stackable: false, slot: "ARMOR", armor: 22, maxDurability: 90 },
  helmet: { key: "helmet", name: "Riot Helmet", icon: "⛑️", category: "ARMOR", tier: 2, stackable: false, slot: "HELMET", armor: 10, maxDurability: 70 },
  rucksack: { key: "rucksack", name: "Trekking Rucksack", icon: "🎒", category: "ARMOR", tier: 2, stackable: false, slot: "BACKPACK", carryBonus: 8, maxDurability: 100 },

  // ── Consumables ────────────────────────────────────────────────────────────
  bandage: { key: "bandage", name: "Bandage", icon: "🩹", category: "CONSUMABLE", tier: 1, stackable: true, heal: 20 },
  medkit: { key: "medkit", name: "Medkit", icon: "🧰", category: "CONSUMABLE", tier: 2, stackable: true, heal: 55 },
  radaway: { key: "radaway", name: "Rad-Away", icon: "💉", category: "CONSUMABLE", tier: 2, stackable: true, reduceRad: 40 },
  stim: { key: "stim", name: "Stimpack", icon: "⚡", category: "CONSUMABLE", tier: 2, stackable: true, restoreStamina: 50, heal: 10 },

  // ── Resources (deposit into shelter on return) ─────────────────────────────
  ration: { key: "ration", name: "Canned Ration", icon: "🥫", category: "RESOURCE", tier: 1, stackable: true, resource: "food", resourceAmount: 5 },
  water_bottle: { key: "water_bottle", name: "Water Bottle", icon: "🚰", category: "RESOURCE", tier: 1, stackable: true, resource: "water", resourceAmount: 5 },
  meds: { key: "meds", name: "Medical Supplies", icon: "💊", category: "RESOURCE", tier: 2, stackable: true, resource: "meds", resourceAmount: 4 },
  ammo: { key: "ammo", name: "Ammunition", icon: "🧨", category: "RESOURCE", tier: 1, stackable: true, resource: "ammo", resourceAmount: 8 },
  scrap: { key: "scrap", name: "Scrap Metal", icon: "🔩", category: "RESOURCE", tier: 1, stackable: true, resource: "scrap", resourceAmount: 6 },
  fuel: { key: "fuel", name: "Fuel Canister", icon: "⛽", category: "RESOURCE", tier: 2, stackable: true, resource: "fuel", resourceAmount: 5 },

  // ── Crafting materials (Phase 2 recipes) ───────────────────────────────────
  electronics: { key: "electronics", name: "Electronics", icon: "🔌", category: "MATERIAL", tier: 3, stackable: true },
  cloth: { key: "cloth", name: "Cloth", icon: "🧵", category: "MATERIAL", tier: 1, stackable: true },
  gunpowder: { key: "gunpowder", name: "Gunpowder", icon: "🧪", category: "MATERIAL", tier: 2, stackable: true },
};

export function itemDef(key: string): ItemDef | undefined {
  return ITEM_DEFS[key];
}

/** Starting kit for a new character. */
export const STARTER_ITEMS: { defKey: string; quantity: number; equip?: EquipSlot }[] = [
  { defKey: "bat", quantity: 1, equip: "PRIMARY" },
  { defKey: "jacket", quantity: 1, equip: "ARMOR" },
  { defKey: "bandage", quantity: 3 },
];
