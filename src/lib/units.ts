import type { UnitType } from "@prisma/client";

// Per-unit stats. `combat` is the offensive/defensive power one unit contributes;
// costs are paid on recruitment, upkeep feeds the super-linear economy drain.
// `domain` controls which force (army/fleet/airwing) a unit can join.
export interface UnitStat {
  combat: number;
  moneyCost: number; // billions
  manpowerCost: number; // millions
  domain: "LAND" | "AIR" | "NAVAL" | "SPECIAL";
  speedKmh: number;
  sight: number; // vision radius in degrees
  label: string;
}

export const UNIT_STATS: Record<UnitType, UnitStat> = {
  INFANTRY: { combat: 8, moneyCost: 0.4, manpowerCost: 0.05, domain: "LAND", speedKmh: 30, sight: 1.5, label: "Infantry" },
  MECHANIZED: { combat: 14, moneyCost: 0.9, manpowerCost: 0.04, domain: "LAND", speedKmh: 45, sight: 1.8, label: "Mechanized" },
  TANK: { combat: 22, moneyCost: 1.6, manpowerCost: 0.03, domain: "LAND", speedKmh: 40, sight: 1.8, label: "Tank" },
  ARTILLERY: { combat: 18, moneyCost: 1.2, manpowerCost: 0.02, domain: "LAND", speedKmh: 25, sight: 1.5, label: "Artillery" },
  AIR_DEFENSE: { combat: 10, moneyCost: 1.0, manpowerCost: 0.02, domain: "LAND", speedKmh: 30, sight: 2.2, label: "Air Defense" },
  FIGHTER: { combat: 20, moneyCost: 2.0, manpowerCost: 0.01, domain: "AIR", speedKmh: 900, sight: 4, label: "Fighter" },
  BOMBER: { combat: 26, moneyCost: 2.8, manpowerCost: 0.01, domain: "AIR", speedKmh: 800, sight: 3, label: "Bomber" },
  DRONE: { combat: 12, moneyCost: 0.8, manpowerCost: 0, domain: "AIR", speedKmh: 600, sight: 4.5, label: "Drone" },
  TRANSPORT_AIR: { combat: 2, moneyCost: 1.0, manpowerCost: 0.01, domain: "AIR", speedKmh: 700, sight: 2, label: "Transport" },
  FRIGATE: { combat: 16, moneyCost: 2.0, manpowerCost: 0.01, domain: "NAVAL", speedKmh: 50, sight: 3, label: "Frigate" },
  DESTROYER: { combat: 24, moneyCost: 3.5, manpowerCost: 0.01, domain: "NAVAL", speedKmh: 55, sight: 3.5, label: "Destroyer" },
  SUBMARINE: { combat: 22, moneyCost: 4.0, manpowerCost: 0.01, domain: "NAVAL", speedKmh: 40, sight: 2, label: "Submarine" },
  CARRIER: { combat: 40, moneyCost: 12, manpowerCost: 0.05, domain: "NAVAL", speedKmh: 50, sight: 4, label: "Carrier" },
  MISSILE: { combat: 30, moneyCost: 1.5, manpowerCost: 0, domain: "SPECIAL", speedKmh: 3000, sight: 1, label: "Missile" },
  NUKE: { combat: 200, moneyCost: 20, manpowerCost: 0, domain: "SPECIAL", speedKmh: 3000, sight: 1, label: "Nuclear" },
  INTEL: { combat: 4, moneyCost: 0.6, manpowerCost: 0.01, domain: "SPECIAL", speedKmh: 0, sight: 5, label: "Intel" },
};

/** Combat power of a force given its units (count × per-unit combat × health). */
export function forceStrength(units: { type: UnitType; count: number; health: number }[]): number {
  return units.reduce((sum, u) => sum + UNIT_STATS[u.type].combat * u.count * (u.health / 100), 0);
}
