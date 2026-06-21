// Building economics — kept free of Prisma imports so both server actions and
// client components can use it. Keys are BuildingType enum string values.

export type BuildTier = "fast" | "med" | "slow";

const FAST = ["HOUSING", "FARM", "ROAD"];
const SLOW = ["MISSILE_SILO", "NAVAL_BASE", "AIRPORT", "AIR_BASE"];

export function buildingTier(type: string): BuildTier {
  if (FAST.includes(type)) return "fast";
  if (SLOW.includes(type)) return "slow";
  return "med";
}

const TIER_COST: Record<BuildTier, { money: number; steel: number }> = {
  fast: { money: 2, steel: 1 },
  med: { money: 8, steel: 4 },
  slow: { money: 20, steel: 10 },
};

// In-game durations (compressed at runtime by SIM.baseRate × speed).
const TIER_MS: Record<BuildTier, number> = {
  fast: 4 * 3_600_000, // 4h
  med: 24 * 3_600_000, // 1d
  slow: 72 * 3_600_000, // 3d
};

/** Cost to build/upgrade to `targetLevel` (scales with level). */
export function buildingCost(type: string, targetLevel: number): { money: number; steel: number } {
  const c = TIER_COST[buildingTier(type)];
  return { money: c.money * targetLevel, steel: c.steel * targetLevel };
}

export function buildingDurationMs(type: string): number {
  return TIER_MS[buildingTier(type)];
}
