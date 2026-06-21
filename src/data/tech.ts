import type { ResearchCategory } from "@prisma/client";

// Static tech tree. `days` is base research time at neutral budget; `effect`
// keys are read by the simulation when a project completes.
export interface TechNode {
  key: string;
  name: string;
  category: ResearchCategory;
  days: number;
  requires?: string[];
  // Multipliers / flat bonuses applied on completion.
  effect: Partial<{
    gdpGrowthMult: number;
    unitStrengthMult: number;
    moraleBonus: number;
    researchSpeedMult: number;
    resourceYieldMult: number;
  }>;
}

export const TECH_TREE: TechNode[] = [
  // Economy
  { key: "eco_logistics", name: "Modern Logistics", category: "ECONOMY", days: 2, effect: { gdpGrowthMult: 1.1 } },
  { key: "eco_markets", name: "Open Markets", category: "ECONOMY", days: 4, requires: ["eco_logistics"], effect: { gdpGrowthMult: 1.15 } },
  // Energy
  { key: "energy_grid", name: "Smart Grid", category: "ENERGY", days: 3, effect: { resourceYieldMult: 1.2 } },
  { key: "energy_fusion", name: "Fusion Pilot", category: "ENERGY", days: 8, requires: ["energy_grid"], effect: { resourceYieldMult: 1.5 } },
  // Military
  { key: "mil_doctrine", name: "Combined Arms Doctrine", category: "MILITARY", days: 3, effect: { unitStrengthMult: 1.15 } },
  { key: "mil_armor", name: "Advanced Armor", category: "MILITARY", days: 6, requires: ["mil_doctrine"], effect: { unitStrengthMult: 1.25 } },
  // Intelligence
  { key: "intel_signals", name: "Signals Intelligence", category: "INTELLIGENCE", days: 4, effect: { moraleBonus: 5 } },
  // Infrastructure
  { key: "infra_rail", name: "High-Speed Rail", category: "INFRASTRUCTURE", days: 4, effect: { gdpGrowthMult: 1.1, researchSpeedMult: 1.1 } },
];

export const TECH_BY_KEY: Record<string, TechNode> = Object.fromEntries(
  TECH_TREE.map((t) => [t.key, t])
);

/** Plain-language summary of what completing a tech grants the player. */
export function describeEffect(effect: TechNode["effect"]): string {
  const parts: string[] = [];
  const pct = (m: number) => `${m >= 1 ? "+" : "−"}${Math.round(Math.abs(m - 1) * 100)}%`;
  if (effect.gdpGrowthMult) parts.push(`${pct(effect.gdpGrowthMult)} GDP growth`);
  if (effect.unitStrengthMult) parts.push(`${pct(effect.unitStrengthMult)} unit strength`);
  if (effect.resourceYieldMult) parts.push(`${pct(effect.resourceYieldMult)} resource yield`);
  if (effect.researchSpeedMult) parts.push(`${pct(effect.researchSpeedMult)} research speed`);
  if (effect.moraleBonus) parts.push(`${effect.moraleBonus >= 0 ? "+" : ""}${effect.moraleBonus} national morale`);
  return parts.join(" · ") || "No direct bonus";
}
