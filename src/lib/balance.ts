// Central tuning table. All gameplay constants live here so balancing is a
// single-file iteration. Values are intentionally simple and readable.

export const SIM = {
  /** Global time compression: in-game time runs this many times faster than
   *  real time at the player's "1×" speed. The whole simulation — economy,
   *  combat, construction, research, movement — is scaled uniformly by this,
   *  so a full real-world-days campaign plays out in a couple of hours.
   *  Effective multiplier = SIM.baseRate × the player's speed setting. */
  baseRate: 600,
  /** Default player speed setting for a new game (multiplies baseRate). */
  defaultSpeed: 1,
  /** Player speed bounds (multiplies baseRate). */
  minSpeed: 0.25,
  maxSpeed: 8,
} as const;

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

export const BUDGET = {
  /** Each discretionary budget (military/welfare/infra/research) spends this
   *  fraction of GDP per day at 100% allocation. Tax revenue funds the pool;
   *  over-spending pushes the treasury into deficit. */
  spendPerDayAt100: 0.1,
  /** Welfare: national morale-target bonus at 100% welfare budget. */
  welfareMoraleAt100: 14,
  /** Infrastructure: fraction of the gap to the budget % closed per day. */
  infraDriftPerDay: 0.5,
  /** Military: manpower mobilised per day at 100%, as a fraction of population
   *  (capped at total population). */
  mobilizationPerDayAt100: 0.02,
  /** Minutes of dtScale in a day (dtScale = ms / 60_000). */
  minutesPerDay: 1440,
} as const;

// Durations are in *in-game* time. The game runs many times faster than real
// time (see SIM.defaultSpeed / the speed control), so these compress into
// minutes of play — a full campaign in a couple of hours.
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
  /** Zone morale lost per minute per net attacker-strength point (capture meter). */
  moraleRate: 0.01,
  /** Zone morale recovered per minute per net defender-strength point when holding. */
  moraleRecover: 0.004,
  /** Attrition to attacker health per minute while engaged. */
  attritionRate: 0.02,
  /** Morale a freshly captured (occupied) zone starts at. */
  capturedMorale: 35,
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

export const STRIKE = {
  /** Cooldown before a force can strike again (ms). */
  cooldownMs: 2 * 3_600_000,
  /** Zone morale damage per point of striking force strength. */
  moraleFactor: 0.35,
} as const;

export const FOG = {
  /** Vision radius (degrees) a controlled zone provides. */
  zoneSight: 2.0,
  /** Vision radius for a zone with a radar station. */
  radarSight: 6.0,
  /** Minimum vision a stationed army provides regardless of unit type. */
  armyMinSight: 1.2,
} as const;
