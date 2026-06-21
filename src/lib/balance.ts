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

export const COMBAT = {
  /** How fast control flips per minute per net-strength point. */
  controlRate: 0.0008,
  /** Attrition to attacker health per minute while engaged. */
  attritionRate: 0.02,
  /** Terrain defensive multipliers. */
  terrain: { PLAINS: 1, FOREST: 1.2, MOUNTAIN: 1.5, DESERT: 0.9, URBAN: 1.4, COASTAL: 1.1 } as Record<string, number>,
} as const;

export const AI = {
  /** Probability an AI nation takes an action per catch-up. */
  actChance: 0.25,
  /** Opinion below which an aggressive AI may declare war. */
  warThreshold: -40,
  /** Strength ratio (attacker/defender) an AI wants before invading. */
  warStrengthRatio: 1.4,
} as const;

export const TRADE = {
  /** Notional market price (money per unit) by good. */
  price: { OIL: 0.08, FOOD: 0.04, STEEL: 0.06, RARE_MATERIALS: 0.3, MONEY: 1, TECHNOLOGY: 0.5 } as Record<string, number>,
} as const;

export const RESEARCH = {
  /** Progress points per minute at 100% research budget allocation. */
  baseProgressPerMin: 0.6,
} as const;

export const DIPLOMACY = {
  declareWarOpinionHit: 40, // opinion lost with target & their allies
  improveStep: 12, // opinion gained per diplomatic action
  influenceCostImprove: 3,
} as const;

export const FOG = {
  /** Vision radius (degrees) a controlled zone provides. */
  zoneSight: 2.0,
  /** Vision radius for a zone with a radar station. */
  radarSight: 6.0,
  /** Minimum vision a stationed army provides regardless of unit type. */
  armyMinSight: 1.2,
} as const;
