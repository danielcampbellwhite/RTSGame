// The persistent city. Geography (streets, buildings, the shelter) is a pure
// function of CITY_SEED, so it is identical on every venture. Only the enemies
// and loot that populate it are re-rolled each time, from the expedition seed.
//
// Layout: a grid of BLOCKS×BLOCKS building lots separated by one-tile streets.
// You walk the streets top-down; buildings block movement; each has one door
// that drops you into a bounded interior room you loot (interiors reuse the
// wasteland tile generator). The shelter is a fixed lot you return to.

import { mulberry32, hashSeed, tileRng, weighted, pick } from "@/lib/rng";
import { BUILDING_TYPES, type BuildingType } from "@/data/buildings";
import { LOCATIONS, ENEMIES, ENEMY_KEYS } from "@/data/world";
import { tileAt, type Tile, type FeatureKind } from "@/lib/wasteland";
import type { Biome } from "@/data/world";

const CITY_SEED = 0x5eedface;
const BS = 3; // building footprint is BS×BS
const STRIDE = BS + 1; // one street tile between lots
export const BLOCKS = 5; // BLOCKS×BLOCKS lots
export const CITY_DIM = BLOCKS * STRIDE + 1; // tiles per side (streets bracket every lot)

const SHELTER_BX = 2;
const SHELTER_BY = BLOCKS - 1; // bottom-centre

export type Side = "N" | "S" | "E" | "W";
export type TerrainKind = "STREET" | "LOT" | "BUILDING" | "DOOR" | "SHELTER" | "EDGE";

export interface Building {
  id: string;
  type: BuildingType;
  name: string;
  icon: string;
  lootKey: string;
  bx: number;
  by: number;
  tier: number;
  size: number; // interior grid is size×size
  biome: Biome;
  doorX: number;
  doorY: number; // street-facing tile you step onto to enter
  seedSalt: number; // per-building seed component
}

function blockTier(bx: number, by: number): number {
  const d = Math.max(Math.abs(bx - SHELTER_BX), Math.abs(by - SHELTER_BY));
  return Math.max(1, Math.min(5, 1 + d));
}

// Footprint origin (top-left interior tile) of a lot.
function lotOrigin(bx: number, by: number): [number, number] {
  return [bx * STRIDE + 1, by * STRIDE + 1];
}

function doorFor(bx: number, by: number, side: Side): [number, number] {
  const [ox, oy] = lotOrigin(bx, by);
  const mid = Math.floor(BS / 2);
  switch (side) {
    case "N": return [ox + mid, oy];
    case "S": return [ox + mid, oy + BS - 1];
    case "W": return [ox, oy + mid];
    case "E": return [ox + BS - 1, oy + mid];
  }
}

// ── build the city once, deterministically ─────────────────────────────────

const BUILDINGS: Building[] = [];
const BLOCK_KIND: ("building" | "lot" | "shelter")[][] = [];
const DOOR_AT = new Map<string, Building>();
let SHELTER_DOOR: [number, number] = [0, 0];

(function build() {
  const sides: Side[] = ["N", "S", "E", "W"];
  let idx = 0;
  for (let bx = 0; bx < BLOCKS; bx++) {
    BLOCK_KIND[bx] = [];
    for (let by = 0; by < BLOCKS; by++) {
      const rng = mulberry32(hashSeed(CITY_SEED, bx + 1, by + 1));
      if (bx === SHELTER_BX && by === SHELTER_BY) {
        BLOCK_KIND[bx][by] = "shelter";
        SHELTER_DOOR = doorFor(bx, by, "N");
        continue;
      }
      // A handful of lots are open ground (parks / rubble) — walkable, no building.
      if (rng() < 0.16) {
        BLOCK_KIND[bx][by] = "lot";
        continue;
      }
      BLOCK_KIND[bx][by] = "building";
      const tier = blockTier(bx, by);
      const pool = BUILDING_TYPES.filter((t) => t.minTier <= tier);
      const type = weighted<BuildingType>(rng, pool.map((t) => [t, t.weight] as [BuildingType, number]));
      // Pick a side whose approach street is inside the map.
      const side = pick(rng, sides.filter((s) => {
        const [dx, dy] = doorFor(bx, by, s);
        const ax = s === "W" ? dx - 1 : s === "E" ? dx + 1 : dx;
        const ay = s === "N" ? dy - 1 : s === "S" ? dy + 1 : dy;
        return ax >= 0 && ay >= 0 && ax < CITY_DIM && ay < CITY_DIM;
      }));
      const [doorX, doorY] = doorFor(bx, by, side);
      const size = Math.max(4, Math.min(9, 4 + tier));
      const b: Building = {
        id: `b${idx++}`,
        type, name: type.name, icon: type.icon, lootKey: type.lootKey,
        bx, by, tier, size, biome: type.biome, doorX, doorY,
        seedSalt: hashSeed(bx + 31, by + 17),
      };
      BUILDINGS.push(b);
      DOOR_AT.set(`${doorX},${doorY}`, b);
    }
  }
})();

export { BUILDINGS, SHELTER_DOOR };
export const BUILDINGS_BY_ID: Record<string, Building> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

// ── static terrain ──────────────────────────────────────────────────────────

function isStreet(x: number, y: number): boolean {
  return x % STRIDE === 0 || y % STRIDE === 0;
}

export interface Terrain {
  kind: TerrainKind;
  building: Building | null;
}

export function cityTerrain(x: number, y: number): Terrain {
  if (x < 0 || y < 0 || x >= CITY_DIM || y >= CITY_DIM) return { kind: "EDGE", building: null };
  if (isStreet(x, y)) return { kind: "STREET", building: null };
  const bx = Math.floor(x / STRIDE);
  const by = Math.floor(y / STRIDE);
  const kind = BLOCK_KIND[bx]?.[by];
  if (kind === "shelter") {
    return x === SHELTER_DOOR[0] && y === SHELTER_DOOR[1]
      ? { kind: "SHELTER", building: null }
      : { kind: "BUILDING", building: null };
  }
  if (kind === "lot") return { kind: "LOT", building: null };
  const door = DOOR_AT.get(`${x},${y}`);
  if (door) return { kind: "DOOR", building: door };
  return { kind: "BUILDING", building: null };
}

export function passable(x: number, y: number): boolean {
  const k = cityTerrain(x, y).kind;
  return k === "STREET" || k === "LOT" || k === "DOOR" || k === "SHELTER";
}

export function cityTierAt(x: number, y: number): number {
  const bx = Math.max(0, Math.min(BLOCKS - 1, Math.floor(x / STRIDE)));
  const by = Math.max(0, Math.min(BLOCKS - 1, Math.floor(y / STRIDE)));
  return blockTier(bx, by);
}

// ── dynamic content (per venture) ───────────────────────────────────────────

const STREET_LOOT: { icon: string; label: string }[] = [
  { icon: "🚗", label: "Wrecked Car" },
  { icon: "🗑️", label: "Dumpster" },
  { icon: "💀", label: "Corpse" },
  { icon: "🛒", label: "Abandoned Cart" },
];

/** What roams or litters a walkable street tile this venture. Pure in
 *  (ventureSeed, x, y); empty for non-walkable tiles. */
export function cityFeature(ventureSeed: number, x: number, y: number): Tile {
  const tier = cityTierAt(x, y);
  const rng = tileRng(hashSeed(ventureSeed, 4242), x, y);
  // Streets are mostly bare tarmac — real hauls are inside the buildings, and
  // roamers are sparse so each one reads as a real threat.
  const feature = weighted<FeatureKind>(rng, [
    ["EMPTY", 92],
    ["ENEMY", 5 + tier],
    ["LOOT", 5],
  ]);
  if (feature === "ENEMY") {
    const candidates = ENEMY_KEYS.filter((k) => ENEMIES[k].minTier <= tier);
    const enemyKey = pick(rng, candidates.length ? candidates : ["scavenger"]);
    const e = ENEMIES[enemyKey];
    return { x, y, biome: "URBAN", tier, feature: "ENEMY", enemyKey, icon: e.icon, label: e.name };
  }
  if (feature === "LOOT") {
    const s = STREET_LOOT[Math.floor(rng() * STREET_LOOT.length)];
    return { x, y, biome: "URBAN", tier, feature: "LOOT", locationKey: "town", icon: s.icon, label: s.label };
  }
  return { x, y, biome: "URBAN", tier, feature: "EMPTY", icon: "·", label: "Street" };
}

/** A bounded interior tile. Loot tiles are themed to the building's archetype. */
export function interiorTile(building: Building, ventureSeed: number, x: number, y: number): Tile {
  const seed = hashSeed(ventureSeed, building.seedSalt);
  const t = tileAt(seed, x, y, building.tier);
  if (t.feature === "LOOT") {
    const loc = LOCATIONS[building.lootKey];
    return { ...t, locationKey: building.lootKey, icon: loc.icon, label: loc.name };
  }
  return t;
}

/** Per-building interior seed (used for loot generation lookups). */
export function interiorSeed(building: Building, ventureSeed: number): number {
  return hashSeed(ventureSeed, building.seedSalt);
}
