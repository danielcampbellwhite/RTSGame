// Seed-based procedural wasteland. Every tile is a pure function of
// (seed, x, y), so the world is reproducible and effectively endless. Danger
// and loot quality scale with Chebyshev distance from the shelter exit (0,0).

import { tileRng, mulberry32, hashSeed, randInt, weighted, pick, chance, type Rng } from "@/lib/rng";
import { ITEM_DEFS } from "@/data/items";
import { BIOMES, LOCATIONS, LOCATION_KEYS, ENEMIES, ENEMY_KEYS, type Biome, type HazardKind, type LootTable } from "@/data/world";
import { survivorName } from "@/data/flavor";

export type FeatureKind = "EXIT" | "EMPTY" | "LOOT" | "ENEMY" | "HAZARD" | "CACHE" | "SURVIVOR";

export interface LootDrop {
  defKey: string;
  quantity: number;
  durability: number | null;
}

export interface Tile {
  x: number;
  y: number;
  biome: Biome;
  tier: number; // 1..5
  feature: FeatureKind;
  locationKey?: string;
  enemyKey?: string;
  hazard?: HazardKind;
  survivorName?: string;
  icon: string;
  label: string;
}

/** Features worth spotting from a distance (via `look`). */
const NOTABLE: FeatureKind[] = ["LOOT", "ENEMY", "HAZARD", "SURVIVOR"];

export const MAX_TIER = 5;

export function chebyshev(x: number, y: number): number {
  return Math.max(Math.abs(x), Math.abs(y));
}

/** Distance → tier (risk/reward band). Every ~3 tiles steps up a tier. */
export function tierForDistance(d: number): number {
  return Math.max(1, Math.min(MAX_TIER, 1 + Math.floor(d / 3)));
}

/** Low-frequency biome regions (4x4 cells), drifting irradiated as you go out. */
function biomeAt(seed: number, x: number, y: number, tier: number): Biome {
  const rng = mulberry32(hashSeed(seed + 7, Math.floor(x / 4), Math.floor(y / 4)));
  const radWeight = 1 + tier; // irradiated zones grow common deeper out
  return weighted<Biome>(rng, [
    ["WASTES", 5],
    ["FOREST", 4],
    ["URBAN", 4],
    ["INDUSTRIAL", 3],
    ["IRRADIATED", radWeight],
  ]);
}

export function tileAt(seed: number, x: number, y: number, tierOverride?: number): Tile {
  const d = chebyshev(x, y);
  const tier = tierOverride ?? tierForDistance(d);
  const biome = biomeAt(seed, x, y, tier);

  // Only the infinite-world origin is the shelter exit; inside a bounded zone
  // (tierOverride set) every tile is explorable terrain.
  if (tierOverride == null && d === 0) {
    return { x, y, biome, tier, feature: "EXIT", icon: "🏠", label: "Shelter Exit" };
  }

  const rng = tileRng(seed, x, y);

  // Feature distribution shifts toward danger + density with tier.
  const feature = weighted<FeatureKind>(rng, [
    ["EMPTY", Math.max(34, 60 - tier * 4)],
    ["LOOT", 20 + tier * 3],
    ["ENEMY", 4 + tier],
    ["HAZARD", biome === "IRRADIATED" ? 8 + tier * 2 : 2 + tier],
    ["CACHE", 4],
    ["SURVIVOR", 4],
  ]);

  if (feature === "LOOT") {
    const candidates = LOCATION_KEYS.filter((k) => (k !== "bunker" || tier >= 3) && (k !== "checkpoint" || tier >= 2));
    const locationKey = pick(rng, candidates);
    const loc = LOCATIONS[locationKey];
    return { x, y, biome, tier, feature, locationKey, icon: loc.icon, label: loc.name };
  }
  if (feature === "ENEMY") {
    const candidates = ENEMY_KEYS.filter((k) => ENEMIES[k].minTier <= tier);
    const enemyKey = pick(rng, candidates);
    return { x, y, biome, tier, feature, enemyKey, icon: ENEMIES[enemyKey].icon, label: ENEMIES[enemyKey].name };
  }
  if (feature === "HAZARD") {
    const hazard: HazardKind = biome === "IRRADIATED" || chance(rng, 0.6) ? "RADIATION" : "TOXIC";
    return { x, y, biome, tier, feature, hazard, icon: hazard === "RADIATION" ? "☢️" : "🧪", label: hazard === "RADIATION" ? "Radiation Zone" : "Toxic Spill" };
  }
  if (feature === "CACHE") {
    return { x, y, biome, tier, feature, icon: "📦", label: "Hidden Cache" };
  }
  if (feature === "SURVIVOR") {
    const name = survivorName(rng);
    return { x, y, biome, tier, feature, survivorName: name, icon: "🧑", label: `Survivor (${name})` };
  }
  return { x, y, biome, tier, feature: "EMPTY", icon: BIOMES[biome].char, label: BIOMES[biome].name };
}

/** Notable tiles along a direction within `range`, nearest first — used by
 *  `look` to let the player scout what lies ahead before committing. */
export function scanAhead(seed: number, x: number, y: number, dx: number, dy: number, range: number): { dist: number; tile: Tile }[] {
  const hits: { dist: number; tile: Tile }[] = [];
  for (let i = 1; i <= range; i++) {
    const t = tileAt(seed, x + dx * i, y + dy * i);
    if (NOTABLE.includes(t.feature)) hits.push({ dist: i, tile: t });
  }
  return hits;
}

/** Draw loot from a table, gated by tier; quantities scale with tier. */
export function generateLoot(rng: Rng, table: LootTable, tier: number, draws: [number, number]): LootDrop[] {
  const pool = table.filter(([k]) => (ITEM_DEFS[k]?.tier ?? 99) <= tier);
  if (!pool.length) return [];
  const n = randInt(rng, draws[0], draws[1]) + Math.floor(tier / 2);
  const merged = new Map<string, LootDrop>();
  for (let i = 0; i < n; i++) {
    const key = weighted(rng, pool);
    const def = ITEM_DEFS[key];
    if (!def) continue;
    if (def.stackable) {
      const qty = randInt(rng, 1, 2 + tier);
      const cur = merged.get(key);
      if (cur) cur.quantity += qty;
      else merged.set(key, { defKey: key, quantity: qty, durability: null });
    } else {
      // Non-stackables are distinct rolls (each its own instance).
      merged.set(`${key}#${i}`, { defKey: key, quantity: 1, durability: def.maxDurability ?? null });
    }
  }
  return [...merged.values()];
}

/** Loot for a location tile. */
export function lootForTile(seed: number, tile: Tile): LootDrop[] {
  if (tile.feature === "LOOT" && tile.locationKey) {
    const loc = LOCATIONS[tile.locationKey];
    const rng = tileRng(seed, tile.x, tile.y);
    rng(); // advance past the feature roll
    return generateLoot(rng, loc.loot, tile.tier, loc.draws);
  }
  if (tile.feature === "CACHE") {
    const rng = tileRng(seed, tile.x * 3 + 1, tile.y * 3 + 1);
    return generateLoot(rng, [["ration", 4], ["water_bottle", 4], ["bandage", 3], ["scrap", 3], ["ammo", 3]], tile.tier, [1, 2]);
  }
  return [];
}

export interface EnemyInstance {
  key: string;
  name: string;
  icon: string;
  power: number;
  hpHit: number;
  fleeable: number;
}

function scaleEnemy(def: { key: string; name: string; icon: string; power: number; hpHit: number; fleeable: number }, tier: number): EnemyInstance {
  const scale = 1 + (tier - 1) * 0.35;
  return {
    key: def.key,
    name: def.name,
    icon: def.icon,
    power: Math.round(def.power * scale),
    hpHit: Math.round(def.hpHit * scale),
    fleeable: def.fleeable,
  };
}

/** Build a scaled enemy for a tile (power/damage grow with tier). */
export function enemyForTile(tile: Tile): EnemyInstance | null {
  if (tile.feature !== "ENEMY" || !tile.enemyKey) return null;
  return scaleEnemy(ENEMIES[tile.enemyKey], tile.tier);
}

/** A wandering enemy that can ambush during a search/rest. */
export function wanderingEnemy(rng: Rng, tier: number): EnemyInstance {
  const candidates = ENEMY_KEYS.filter((k) => ENEMIES[k].minTier <= tier);
  return scaleEnemy(ENEMIES[pick(rng, candidates)], tier);
}
