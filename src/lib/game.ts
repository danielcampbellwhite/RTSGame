// Survival tuning + pure helpers shared by the server actions. Kept free of
// Prisma/DB so the math is easy to reason about and adjust in one place.

import type { Rng } from "@/lib/rng";

export const SURV = {
  // Shelter resource depletion per real-world hour (consumed by daily living).
  depletionPerHour: { food: 3, water: 4, fuel: 1.5 } as Record<string, number>,
  /** Below this level a resource is "critical" and morale suffers. */
  lowThreshold: 15,
  /** Real seconds of one expedition step's stamina cost. */
  moveStaminaCost: 6,
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

export interface ShelterResources {
  food: number;
  water: number;
  meds: number;
  ammo: number;
  scrap: number;
  fuel: number;
  morale: number;
  lastTickAt: Date;
}

/** Apply passive resource depletion for the elapsed real time. Pure. */
export function depleteResources<T extends ShelterResources>(s: T, now: Date): T {
  const hours = Math.max(0, (now.getTime() - s.lastTickAt.getTime()) / 3_600_000);
  if (hours <= 0) return s;
  const food = Math.max(0, s.food - SURV.depletionPerHour.food * hours);
  const water = Math.max(0, s.water - SURV.depletionPerHour.water * hours);
  const fuel = Math.max(0, s.fuel - SURV.depletionPerHour.fuel * hours);
  // Morale drifts toward a target set by how well-stocked the essentials are.
  const lacking = (food < SURV.lowThreshold ? 1 : 0) + (water < SURV.lowThreshold ? 1 : 0);
  const moraleTarget = 90 - lacking * 35;
  const morale = clamp(s.morale + (moraleTarget - s.morale) * Math.min(1, hours * 0.5));
  return { ...s, food, water, fuel, morale, lastTickAt: now };
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
