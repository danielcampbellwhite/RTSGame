// Static wasteland data: biomes, location archetypes, enemies, and the loot
// tables they draw from. Procedural generation (src/lib/wasteland.ts) combines
// these with distance-from-shelter scaling.

export type Biome = "WASTES" | "FOREST" | "URBAN" | "INDUSTRIAL" | "IRRADIATED";

export const BIOMES: Record<Biome, { name: string; color: string; char: string }> = {
  WASTES: { name: "Dust Flats", color: "#6b5b3e", char: "·" },
  FOREST: { name: "Dead Forest", color: "#3f5436", char: "♣" },
  URBAN: { name: "Ruined City", color: "#5a534b", char: "▦" },
  INDUSTRIAL: { name: "Industrial Zone", color: "#5c4a3a", char: "⚙" },
  IRRADIATED: { name: "Irradiated Zone", color: "#5b6b2e", char: "☢" },
};

// A loot table is a list of [itemKey, weight]; entries gated by tier are
// filtered by the tile's effective tier before drawing.
export type LootTable = readonly (readonly [string, number])[];

export interface LocationDef {
  key: string;
  name: string;
  icon: string;
  loot: LootTable;
  /** How many loot draws (before distance bonus). */
  draws: [number, number];
}

export const LOCATIONS: Record<string, LocationDef> = {
  gas_station: {
    key: "gas_station", name: "Gas Station", icon: "⛽", draws: [1, 3],
    loot: [["fuel", 5], ["ration", 4], ["water_bottle", 4], ["scrap", 4], ["pistol", 1], ["ammo", 3]],
  },
  hospital: {
    key: "hospital", name: "Hospital", icon: "🏥", draws: [2, 4],
    loot: [["meds", 6], ["bandage", 5], ["medkit", 3], ["radaway", 3], ["stim", 2], ["scrap", 2]],
  },
  factory: {
    key: "factory", name: "Factory", icon: "🏭", draws: [2, 4],
    loot: [["scrap", 7], ["electronics", 4], ["gunpowder", 3], ["fuel", 3], ["vest", 1], ["ammo", 2]],
  },
  checkpoint: {
    key: "checkpoint", name: "Military Checkpoint", icon: "🪖", draws: [2, 3],
    loot: [["ammo", 6], ["rifle", 1], ["shotgun", 2], ["vest", 3], ["helmet", 3], ["medkit", 2], ["gunpowder", 2]],
  },
  town: {
    key: "town", name: "Ruined Town", icon: "🏚️", draws: [1, 3],
    loot: [["ration", 5], ["water_bottle", 5], ["scrap", 4], ["cloth", 4], ["bandage", 3], ["knife", 2]],
  },
  bunker: {
    key: "bunker", name: "Old Bunker", icon: "🚪", draws: [3, 5],
    loot: [["ammo", 5], ["rifle", 2], ["shotgun", 2], ["medkit", 3], ["radaway", 3], ["electronics", 3], ["vest", 2], ["fuel", 3]],
  },
};

export const LOCATION_KEYS = Object.keys(LOCATIONS);

export interface EnemyDef {
  key: string;
  name: string;
  icon: string;
  power: number; // base combat power
  hpHit: number; // base damage dealt to player on a clean hit
  minTier: number; // distance gate
  fleeable: number; // base flee chance modifier
}

export const ENEMIES: Record<string, EnemyDef> = {
  scavenger: { key: "scavenger", name: "Scavenger", icon: "🥷", power: 14, hpHit: 10, minTier: 1, fleeable: 0.7 },
  wolf: { key: "wolf", name: "Mutated Wolf", icon: "🐺", power: 30, hpHit: 18, minTier: 2, fleeable: 0.4 },
  bear: { key: "bear", name: "Mutated Bear", icon: "🐻", power: 64, hpHit: 38, minTier: 3, fleeable: 0.3 },
};

export const ENEMY_KEYS = Object.keys(ENEMIES);

export type HazardKind = "RADIATION" | "TOXIC";
