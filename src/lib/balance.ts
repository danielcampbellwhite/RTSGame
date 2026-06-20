// Central tuning table. All gameplay constants live here so balancing is a
// single-file iteration. Values are intentionally simple and readable.

export const TICK = {
  /** Logical step size for catch-up integration (ms). */
  stepMs: 60_000,
  /** Max logical steps resolved per catch-up invocation (then coarsen). */
  maxSteps: 720,
  /** Economy/morale recompute every N logical steps. */
  economyEverySteps: 5,
  /** Hourly world-event roll (in logical steps). */
  worldEventEverySteps: 60,
} as const;

export const ECONOMY = {
  /** Fraction of GDP collectable as revenue at 100% tax (annualised → per step). */
  baseTaxYield: 0.0008,
  /** GDP organic growth per economy update, scaled by stability/infra. */
  gdpGrowthBase: 0.00005,
  /** Super-linear exponent on military upkeep to punish unit spam. */
  upkeepExponent: 1.15,
  /** Money upkeep per unit-strength point per economy update. */
  upkeepPerStrength: 0.0006,
  /** Inflation kicks in when treasury goes negative. */
  deficitInflationRate: 0.002,
} as const;

export const MORALE = {
  /** Tax rate above which morale is pressured. */
  comfortableTax: 30,
  taxPenaltyPerPoint: 0.06,
  foodShortagePenalty: 2.0,
  occupationPenalty: 1.5,
  /** Unrest threshold at which a territory attempts secession. */
  secessionUnrest: 80,
  driftToTarget: 0.1,
} as const;

export const CONSTRUCTION = {
  // Build duration (ms) and steel/money cost by building "tier".
  fastMs: 4 * 3_600_000, // 4h  (housing, farm, road)
  medMs: 24 * 3_600_000, // 1d  (factory, barracks, port)
  slowMs: 72 * 3_600_000, // 3d (silo, naval base, airport)
} as const;

export const MOVEMENT = {
  infantryMinMs: 1 * 3_600_000,
  infantryMaxMs: 6 * 3_600_000,
  armorMinMs: 2 * 3_600_000,
  armorMaxMs: 12 * 3_600_000,
} as const;

export const WORLD_EVENTS = {
  /** Per-roll probability that *some* world event fires. */
  chancePerRoll: 0.15,
} as const;
