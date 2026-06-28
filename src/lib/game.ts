// Survival tuning + pure helpers shared by the server actions. Kept free of
// Prisma/DB so the math is easy to reason about and adjust in one place.

import type { Rng } from "@/lib/rng";

export const SURV = {
  // Per assigned worker, per real-world hour.
  jobs: { food: 6, water: 6, scrap: 4, meds: 2 } as Record<string, number>,
  // Consumed per resident, per real-world hour (more mouths = more drain).
  consume: { food: 2, water: 2.5 } as Record<string, number>,
  // The shelter itself burns fuel to stay powered.
  fuelPerHour: 1.5,
  /** Below this level a resource is "critical" and morale suffers. */
  lowThreshold: 15,
  /** Stamina burned per expedition step (a little regenerates each tile, so
   *  the net drain is gentle — the city is large and worth roaming). */
  moveStaminaCost: 4,
  staminaRegenOnTile: 2,
  // Combat
  basePunch: 6,
  armorSoftcap: 45, // armor/(armor+softcap) = damage reduction fraction
  // Radiation
  radPerHazard: [8, 18] as [number, number],
  radDamageThreshold: 60, // above this, radiation chips health each step
  // Progression
  xpPerKill: 12,
  xpPerTier: 4,
  xpToLevel: (lvl: number) => 40 + lvl * 30,
} as const;

export type ResourceKey = "food" | "water" | "meds" | "ammo" | "scrap" | "fuel";
export const RESOURCE_KEYS: ResourceKey[] = ["food", "water", "meds", "ammo", "scrap", "fuel"];

export interface ShelterState {
  food: number;
  water: number;
  meds: number;
  scrap: number;
  fuel: number;
  morale: number;
  population: number;
  workFood: number;
  workWater: number;
  workScrap: number;
  workMeds: number;
  lastTickAt: Date;
}

export interface ShelterTick {
  food: number;
  water: number;
  meds: number;
  scrap: number;
  fuel: number;
  morale: number;
  changed: boolean;
}

/** Advance the shelter economy over elapsed real time: assigned workers produce
 *  resources, every resident consumes food/water, and the shelter burns fuel.
 *  Pure — caller persists the result. */
export function tickShelter(s: ShelterState, now: Date): ShelterTick {
  const hours = Math.max(0, (now.getTime() - s.lastTickAt.getTime()) / 3_600_000);
  const cur = { food: s.food, water: s.water, meds: s.meds, scrap: s.scrap, fuel: s.fuel, morale: s.morale, changed: false };
  if (hours <= 0) return cur;

  const food = Math.max(0, s.food + (s.workFood * SURV.jobs.food - s.population * SURV.consume.food) * hours);
  const water = Math.max(0, s.water + (s.workWater * SURV.jobs.water - s.population * SURV.consume.water) * hours);
  const scrap = s.scrap + s.workScrap * SURV.jobs.scrap * hours;
  const meds = s.meds + s.workMeds * SURV.jobs.meds * hours;
  const fuel = Math.max(0, s.fuel - SURV.fuelPerHour * hours);

  const lacking = (food < SURV.lowThreshold ? 1 : 0) + (water < SURV.lowThreshold ? 1 : 0);
  const moraleTarget = 90 - lacking * 35;
  const morale = clamp(s.morale + (moraleTarget - s.morale) * Math.min(1, hours * 0.5));

  return { food, water, meds, scrap, fuel, morale, changed: true };
}

export function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Combat ──────────────────────────────────────────────────────────────────

export interface FightResult {
  win: boolean;
  damageTaken: number;
  enemyHp: number; // remaining (0 = defeated)
  note: string;
}

export interface PlayerCombat {
  weaponDamage: number;
  accuracy: number;
  hasAmmo: boolean;
  usesAmmo: boolean;
  armor: number;
}

function damageReduction(armor: number): number {
  return armor / (armor + SURV.armorSoftcap);
}

/** One decisive exchange against an enemy with `enemyHp` remaining. */
export function resolveFight(rng: Rng, p: PlayerCombat, enemyPower: number, enemyHit: number, enemyHp: number): FightResult {
  const hit = rng() < p.accuracy;
  // Firearms hit hard but are weak without ammo.
  const ammoMult = p.usesAmmo ? (p.hasAmmo ? 1 : 0.35) : 1;
  const dealt = Math.round((hit ? p.weaponDamage : p.weaponDamage * 0.4) * ammoMult * (0.85 + rng() * 0.3));
  const remaining = Math.max(0, enemyHp - dealt);

  const won = remaining <= 0;
  // Enemy strikes back unless already down before it could (lucky one-shot).
  const incoming = won && hit && rng() < 0.4 ? 0 : enemyHit * (0.7 + rng() * 0.6);
  const damageTaken = Math.max(0, Math.round(incoming * (1 - damageReduction(p.armor))));

  return {
    win: won,
    damageTaken,
    enemyHp: remaining,
    note: won ? "Enemy down." : hit ? "You hit, but it's still standing." : "You missed!",
  };
}

/** Attempt to flee; success scales with the enemy's fleeability and stamina. */
export function resolveFlee(rng: Rng, fleeable: number, stamina: number, enemyHit: number, armor: number): { escaped: boolean; damageTaken: number } {
  const p = Math.min(0.92, fleeable + (stamina / 100) * 0.25);
  if (rng() < p) return { escaped: true, damageTaken: 0 };
  const damageTaken = Math.max(1, Math.round(enemyHit * 0.7 * (1 - damageReduction(armor))));
  return { escaped: false, damageTaken };
}
