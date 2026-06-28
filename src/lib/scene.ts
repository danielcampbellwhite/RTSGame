// Client-side, deterministic read of the world a venture occupies. The canvas
// engine renders + drives movement locally from this; the server only resolves
// discrete actions (search, enter, battle, bank). Pure functions of the
// expedition seed, so client and server agree on what's where.

import { cityTerrain, cityFeature, cityTierAt, interiorTile, BUILDINGS_BY_ID, CITY_DIM, passable, type Building } from "@/lib/city";
import type { ExpeditionView } from "@/lib/types";

export type Terrain = "STREET" | "LOT" | "BUILDING" | "DOOR" | "SHELTER" | "FLOOR" | "EXIT" | "EDGE";
export type Feature = "NONE" | "ENEMY" | "LOOT";

export interface Cell {
  terrain: Terrain;
  walkable: boolean;
  feature: Feature;
  enemyKey?: string;
  tier?: number;
  label?: string;
  icon?: string;
  buildingId?: string;
  buildingName?: string;
}

export interface Scene {
  mode: "CITY" | "INTERIOR";
  size: number; // square bound
  seed: number;
  building: Building | null;
  exitX: number;
  exitY: number;
  cellAt: (x: number, y: number) => Cell;
  key: (x: number, y: number) => string;
}

function tkey(buildingId: string | null, x: number, y: number): string {
  return buildingId ? `${buildingId}:${x},${y}` : `${x},${y}`;
}

export function makeScene(exp: ExpeditionView): Scene {
  const building = exp.buildingId ? BUILDINGS_BY_ID[exp.buildingId] ?? null : null;
  const size = exp.mode === "CITY" ? CITY_DIM : building?.size ?? exp.cityDim;
  const seed = exp.ventureSeed;
  const searched = new Set(exp.searched);
  const cleared = new Set(exp.cleared);
  const exitX = Math.floor(size / 2);
  const exitY = size - 1;
  const key = (x: number, y: number) => tkey(exp.buildingId, x, y);

  const cellAt = (x: number, y: number): Cell => {
    if (exp.mode === "CITY") {
      const ter = cityTerrain(x, y);
      if (ter.kind === "EDGE") return { terrain: "EDGE", walkable: false, feature: "NONE" };
      if (ter.kind === "BUILDING") return { terrain: "BUILDING", walkable: false, feature: "NONE" };
      if (ter.kind === "DOOR" && ter.building) return { terrain: "DOOR", walkable: true, feature: "NONE", buildingId: ter.building.id, buildingName: ter.building.name, icon: ter.building.icon };
      if (ter.kind === "SHELTER") return { terrain: "SHELTER", walkable: true, feature: "NONE", icon: "🏠" };
      const t = cityTerrain(x, y).kind === "LOT" ? "LOT" : "STREET";
      const k = key(x, y);
      const f = cityFeature(seed, x, y);
      const tier = cityTierAt(x, y);
      if (f.feature === "ENEMY" && !cleared.has(k)) return { terrain: t, walkable: true, feature: "ENEMY", enemyKey: f.enemyKey, tier, label: f.label, icon: f.icon };
      if (f.feature === "LOOT" && !searched.has(k)) return { terrain: t, walkable: true, feature: "LOOT", tier, label: f.label, icon: f.icon };
      return { terrain: t, walkable: true, feature: "NONE" };
    }
    // interior
    if (x < 0 || y < 0 || x >= size || y >= size) return { terrain: "EDGE", walkable: false, feature: "NONE" };
    if (x === exitX && y === exitY) return { terrain: "EXIT", walkable: true, feature: "NONE", icon: "🚪" };
    if (!building) return { terrain: "FLOOR", walkable: true, feature: "NONE" };
    const k = key(x, y);
    const t = interiorTile(building, seed, x, y);
    const tier = building.tier;
    if (t.feature === "ENEMY" && !cleared.has(k)) return { terrain: "FLOOR", walkable: true, feature: "ENEMY", enemyKey: t.enemyKey, tier, label: t.label, icon: t.icon };
    if ((t.feature === "LOOT" || t.feature === "CACHE") && !searched.has(k)) return { terrain: "FLOOR", walkable: true, feature: "LOOT", tier, label: t.label, icon: t.icon };
    return { terrain: "FLOOR", walkable: true, feature: "NONE" };
  };

  return { mode: exp.mode, size, seed, building, exitX, exitY, cellAt, key };
}

export { passable };
