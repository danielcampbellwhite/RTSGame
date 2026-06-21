import { prisma } from "@/lib/db";
import { AI, CONSTRUCTION } from "@/lib/balance";
import { TECH_TREE } from "@/data/tech";
import { recruit, getHomeArmy, orderMove } from "@/lib/sim/forces";
import { startResearchProject } from "@/lib/sim/research";
import { declareWar } from "@/lib/sim/diplomacy";
import type { UnitType } from "@prisma/client";

type Rng = () => number;

/**
 * Discrete strategic AI. Runs once per catch-up with fresh DB reads. Each AI
 * nation, with some probability, takes the single highest-weighted action its
 * personality and finances allow. Survival overrides everything.
 */
export async function runAI(gameId: string, rng: Rng): Promise<void> {
  const countries = await prisma.country.findMany({
    where: { gameId, isPlayer: false, isAlive: true },
  });

  for (const c of countries) {
    if (rng() > AI.actChance) continue;

    // ── Survival: stabilise a failing economy/state first. ──
    if (c.money < 0 || c.stability < 35) {
      await prisma.country.update({
        where: { id: c.id },
        data: {
          taxRate: Math.min(45, c.taxRate + 5),
          militaryBudgetPct: Math.max(5, c.militaryBudgetPct - 5),
          welfareBudgetPct: Math.min(50, c.welfareBudgetPct + 5),
        },
      });
      continue;
    }

    // ── Weighted action choice from personality. ──
    const weights = {
      economy: c.aiEconomyFocus,
      military: c.aiMilitaryFocus,
      war: c.aiAggression * (c.aiRiskTolerance / 50),
      diplomacy: c.aiDiplomacyPref,
    };
    const action = weightedPick(weights, rng);

    if (action === "economy") await aiEconomy(c.id, rng);
    else if (action === "military") await aiMilitary(c.id, rng);
    else if (action === "diplomacy") await aiDiplomacy(gameId, c.id, rng);
    else if (action === "war") await aiWar(gameId, c, rng);
  }

  await joinAlliedWars(gameId, rng);
}

/** AI nations join wars on the side of their allies. */
async function joinAlliedWars(gameId: string, rng: Rng) {
  const allied = await prisma.diplomaticRelation.findMany({ where: { allied: true, from: { gameId } }, select: { fromId: true, toId: true } });
  const atWar = await prisma.diplomaticRelation.findMany({ where: { atWar: true, from: { gameId } }, select: { fromId: true, toId: true } });
  if (!allied.length || !atWar.length) return;

  const allies = new Map<string, string[]>();
  for (const r of allied) (allies.get(r.fromId) ?? allies.set(r.fromId, []).get(r.fromId)!).push(r.toId);
  const enemies = new Map<string, Set<string>>();
  for (const r of atWar) (enemies.get(r.fromId) ?? enemies.set(r.fromId, new Set()).get(r.fromId)!).add(r.toId);

  const countries = await prisma.country.findMany({ where: { gameId, isPlayer: false, isAlive: true }, select: { id: true } });
  const alive = new Set(countries.map((c) => c.id));
  for (const c of countries) {
    if (rng() > 0.35) continue;
    const myEnemies = enemies.get(c.id) ?? new Set<string>();
    for (const ally of allies.get(c.id) ?? []) {
      const allyEnemies = enemies.get(ally);
      if (!allyEnemies) continue;
      const join = [...allyEnemies].find((e) => e !== c.id && alive.has(e) && !myEnemies.has(e));
      if (join) {
        await declareWar(gameId, c.id, join); // honour the alliance
        break;
      }
    }
  }
}

async function aiEconomy(countryId: string, rng: Rng) {
  // Prefer starting economy/energy research; otherwise queue a factory.
  const candidates = TECH_TREE.filter((t) => t.category === "ECONOMY" || t.category === "ENERGY");
  const node = candidates[Math.floor(rng() * candidates.length)];
  if ((await startResearchProject(countryId, node.key)) === "ok") return;

  const terr = await prisma.territory.findFirst({ where: { countryId }, orderBy: { population: "desc" } });
  if (!terr) return;
  await prisma.building.create({
    data: {
      territoryId: terr.id,
      type: rng() > 0.5 ? "FACTORY" : "POWER_PLANT",
      level: 0,
      buildingToLevel: 1,
      completesAt: new Date(Date.now() + CONSTRUCTION.medMs),
    },
  });
}

async function aiMilitary(countryId: string, rng: Rng) {
  const type: UnitType = rng() > 0.5 ? "INFANTRY" : "TANK";
  const ok = await recruit(countryId, type, 3);
  if (!ok) {
    const mil = TECH_TREE.find((t) => t.category === "MILITARY");
    if (mil) await startResearchProject(countryId, mil.key);
  }
}

async function aiDiplomacy(gameId: string, countryId: string, rng: Rng) {
  const others = await prisma.country.findMany({
    where: { gameId, isAlive: true, id: { not: countryId } },
    select: { id: true },
  });
  if (!others.length) return;
  const target = others[Math.floor(rng() * others.length)];
  const { adjustOpinion, setFlags } = await import("@/lib/sim/diplomacy");
  await adjustOpinion(countryId, target.id, 8);
  // Warm relations can blossom into an alliance.
  const rel = await prisma.diplomaticRelation.findUnique({
    where: { fromId_toId: { fromId: countryId, toId: target.id } },
  });
  if (rel && rel.opinion >= 55 && !rel.allied && !rel.atWar && rng() < 0.5) {
    await setFlags(countryId, target.id, { allied: true });
  }
}

async function aiWar(
  gameId: string,
  c: { id: string; gdp: number; militaryBudgetPct: number },
  rng: Rng
) {
  // Find a plausibly weaker target the AI already dislikes and isn't at war with.
  const rels = await prisma.diplomaticRelation.findMany({
    where: { fromId: c.id, atWar: false, opinion: { lte: AI.warThreshold } },
    take: 10,
  });
  if (!rels.length) return;
  const rel = rels[Math.floor(rng() * rels.length)];
  const target = await prisma.country.findUnique({ where: { id: rel.toId } });
  if (!target || !target.isAlive) return;

  const myStrength = c.gdp * (c.militaryBudgetPct / 100);
  const theirStrength = target.gdp * (target.militaryBudgetPct / 100);
  if (myStrength < theirStrength * AI.warStrengthRatio) return;

  await declareWar(gameId, c.id, target.id);
  // March the home army on the enemy capital.
  const [army, capital] = await Promise.all([
    getHomeArmy(c.id),
    prisma.territory.findFirst({ where: { countryId: target.id, kind: "CAPITAL" } }),
  ]);
  if (army.strength > 0 && capital) await orderMove(army.id, capital.id);
}

function weightedPick(weights: Record<string, number>, rng: Rng): string {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const [key, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return key;
  }
  return Object.keys(weights)[0];
}
