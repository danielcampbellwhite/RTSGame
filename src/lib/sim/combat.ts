import { COMBAT } from "@/lib/balance";
import type { Prisma, Army, Unit, Territory } from "@prisma/client";

export type SimArmy = Army & { units: Unit[] };

export interface CombatContext {
  territoriesById: Map<string, Territory>;
  armiesByTerritory: Map<string, SimArmy[]>;
  /** territoryId -> new owning countryId for captures this catch-up. */
  captures: Map<string, string>;
  events: Prisma.GameEventCreateManyInput[];
  isoByCountryId: Map<string, string>;
  gameId: string;
}

/**
 * Resolve land combat for one logical step. Engaged armies sitting on foreign
 * territory grind down its control; when control hits zero the sector is
 * captured. Defenders draw on fortifications plus any garrisoning friendly army.
 */
export function stepCombat(armies: SimArmy[], dtMs: number, ctx: CombatContext): void {
  const dt = dtMs / 60_000;
  for (const army of armies) {
    if (army.state !== "ENGAGED" || !army.locationTerritoryId) continue;
    const terr = ctx.territoriesById.get(army.locationTerritoryId);
    if (!terr) continue;

    // Once captured/owned, stand down.
    if (terr.countryId === army.countryId) {
      army.state = "IDLE";
      continue;
    }

    const terrainMult = COMBAT.terrain[terr.terr] ?? 1;
    const garrison = (ctx.armiesByTerritory.get(terr.id) ?? [])
      .filter((a) => a.countryId === terr.countryId)
      .reduce((s, a) => s + a.strength * (a.morale / 100), 0);
    const defense = (terr.defenses + garrison) * terrainMult;
    const attack = army.strength * (army.morale / 100) * (army.supply / 100);

    const net = attack - defense;
    terr.controlPct = clamp(terr.controlPct - net * COMBAT.controlRate * dt * 100);

    // Attrition on the attacker either way; harder when losing.
    const attrition = COMBAT.attritionRate * dt * (net > 0 ? 0.6 : 1.4);
    for (const u of army.units) u.health = clamp(u.health - attrition * 100);
    army.morale = clamp(army.morale - (net > 0 ? 0 : attrition * 50), 0, 100);

    if (terr.controlPct <= 0) {
      // Capture: ownership transfers to the attacker; the sector is occupied.
      ctx.captures.set(terr.id, army.countryId);
      terr.countryId = army.countryId;
      terr.controlPct = 100;
      terr.occupied = true;
      terr.defenses = Math.max(5, terr.defenses * 0.5);
      terr.unrest = Math.min(100, terr.unrest + 30);
      army.state = "IDLE";
      ctx.events.push({
        gameId: ctx.gameId,
        scope: "REGIONAL",
        category: "BATTLE",
        title: `${terr.name} captured`,
        body: `Forces have seized ${terr.name}. The sector is now under occupation.`,
        countryIso: ctx.isoByCountryId.get(army.countryId),
        severity: 3,
      });
    }
  }
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
