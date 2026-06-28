// Building archetypes for the persistent city. Each maps to a loot table from
// world.ts (so a pharmacy yields meds, an armory yields guns) and an icon. The
// city's geography is fixed; only the enemies and loot inside regenerate per
// venture. See lib/city.ts for how these are placed onto the street grid.

import type { Biome } from "@/data/world";

export interface BuildingType {
  key: string;
  name: string;
  icon: string;
  lootKey: string; // -> LOCATIONS in world.ts
  weight: number; // relative spawn frequency
  minTier: number; // only appears in blocks at/after this danger tier
  biome: Biome;
}

export const BUILDING_TYPES: BuildingType[] = [
  { key: "apartments", name: "Apartments", icon: "🏢", lootKey: "town", weight: 7, minTier: 1, biome: "URBAN" },
  { key: "supermarket", name: "Supermarket", icon: "🏪", lootKey: "town", weight: 5, minTier: 1, biome: "URBAN" },
  { key: "diner", name: "Diner", icon: "🍔", lootKey: "town", weight: 4, minTier: 1, biome: "URBAN" },
  { key: "gas_station", name: "Gas Station", icon: "⛽", lootKey: "gas_station", weight: 5, minTier: 1, biome: "URBAN" },
  { key: "pharmacy", name: "Pharmacy", icon: "💊", lootKey: "hospital", weight: 4, minTier: 1, biome: "URBAN" },
  { key: "hardware", name: "Hardware Store", icon: "🔧", lootKey: "factory", weight: 4, minTier: 1, biome: "INDUSTRIAL" },
  { key: "clinic", name: "Clinic", icon: "🏥", lootKey: "hospital", weight: 3, minTier: 2, biome: "URBAN" },
  { key: "warehouse", name: "Warehouse", icon: "🏭", lootKey: "factory", weight: 4, minTier: 2, biome: "INDUSTRIAL" },
  { key: "police", name: "Police Station", icon: "🚓", lootKey: "checkpoint", weight: 3, minTier: 2, biome: "URBAN" },
  { key: "hospital", name: "Hospital", icon: "🏥", lootKey: "hospital", weight: 2, minTier: 3, biome: "URBAN" },
  { key: "armory", name: "Armory", icon: "🔫", lootKey: "checkpoint", weight: 2, minTier: 3, biome: "INDUSTRIAL" },
  { key: "bunker", name: "Old Bunker", icon: "🚪", lootKey: "bunker", weight: 2, minTier: 4, biome: "INDUSTRIAL" },
];

export const BUILDING_TYPES_BY_KEY: Record<string, BuildingType> = Object.fromEntries(
  BUILDING_TYPES.map((b) => [b.key, b])
);
