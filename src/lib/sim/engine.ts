import { prisma } from "@/lib/db";
import { TICK, ECONOMY, MORALE, WORLD_EVENTS } from "@/lib/balance";
import type {
  Country,
  Territory,
  Building,
  GameEvent,
  Prisma,
} from "@prisma/client";

// A deterministic-ish random source seeded per invocation. World events use it;
// keeping it here means a given catch-up window is reproducible enough for tests.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type CountryFull = Country & { territories: (Territory & { buildings: Building[] })[] };

/**
 * Advance a single game's world to the current wall-clock time. This is the one
 * code path used by BOTH on-read catch-up and the cron tick, so the world state
 * is identical regardless of how frequently it runs.
 */
export async function catchUp(gameId: string, now: Date = new Date()): Promise<void> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.paused) return;

  const elapsedMs = now.getTime() - game.lastTickAt.getTime();
  if (elapsedMs < TICK.stepMs) return; // nothing meaningful to do yet

  // Coarsen very long offline gaps so we never exceed the step budget.
  const rawSteps = Math.floor(elapsedMs / TICK.stepMs);
  const steps = Math.min(rawSteps, TICK.maxSteps);
  const stepMs = elapsedMs / steps;

  const countries = (await prisma.country.findMany({
    where: { gameId, isAlive: true },
    include: { territories: { include: { buildings: true } } },
  })) as CountryFull[];

  const rng = mulberry32(game.lastTickAt.getTime() & 0xffffffff);
  const events: Prisma.GameEventCreateManyInput[] = [];

  for (let i = 1; i <= steps; i++) {
    const stepClock = new Date(game.lastTickAt.getTime() + i * stepMs);

    if (i % TICK.economyEverySteps === 0) {
      for (const c of countries) stepEconomy(c, stepMs * TICK.economyEverySteps);
      for (const c of countries) stepMorale(c, stepMs * TICK.economyEverySteps, gameId, events);
    }

    if (i % TICK.worldEventEverySteps === 0) {
      rollWorldEvent(countries, gameId, rng, stepClock, events);
    }
  }

  // Resolve timer-based completions across the whole window.
  await resolveCompletions(gameId, now, events);

  // Persist mutated country + territory state and emit events atomically.
  await prisma.$transaction([
    ...countries.map((c) =>
      prisma.country.update({
        where: { id: c.id },
        data: {
          gdp: c.gdp,
          money: c.money,
          oil: c.oil,
          food: c.food,
          electricity: c.electricity,
          steel: c.steel,
          rareMaterials: c.rareMaterials,
          manpower: c.manpower,
          stability: clamp(c.stability),
          morale: clamp(c.morale),
          population: c.population,
        },
      })
    ),
    ...countries.flatMap((c) =>
      c.territories.map((t) =>
        prisma.territory.update({
          where: { id: t.id },
          data: { morale: clamp(t.morale), unrest: clamp(t.unrest), economy: clamp(t.economy) },
        })
      )
    ),
    ...(events.length ? [prisma.gameEvent.createMany({ data: events })] : []),
    prisma.game.update({ where: { id: gameId }, data: { lastTickAt: now } }),
  ]);
}

// ── ECONOMY ──────────────────────────────────────────────────────────────
function stepEconomy(c: CountryFull, dtMs: number): void {
  const dtScale = dtMs / 60_000; // per-minute scaling

  // Revenue: GDP × tax × stability/infra efficiency.
  const efficiency = (c.stability / 100) * 0.6 + (c.infrastructure / 100) * 0.4;
  const revenue =
    c.gdp * (c.taxRate / 100) * ECONOMY.baseTaxYield * efficiency * dtScale;

  // Upkeep: super-linear in total military strength to punish unit spam.
  const force = totalForceStrength(c);
  const upkeep = Math.pow(force, ECONOMY.upkeepExponent) * ECONOMY.upkeepPerStrength * dtScale;

  c.money += revenue - upkeep;

  // Resource production from buildings.
  const prod = buildingProduction(c);
  c.food += prod.food * dtScale;
  c.electricity += prod.electricity * dtScale;
  c.steel += prod.steel * dtScale;
  c.oil += prod.oil * dtScale;

  // Organic GDP growth, dampened by instability and a deficit penalty.
  const growth = ECONOMY.gdpGrowthBase * efficiency * dtScale;
  c.gdp *= 1 + growth;
  if (c.money < 0) c.gdp *= 1 - ECONOMY.deficitInflationRate * dtScale; // recession pressure
}

function buildingProduction(c: CountryFull) {
  let food = 0,
    electricity = 0,
    steel = 0,
    oil = 0;
  for (const t of c.territories) {
    const ctrl = t.controlPct / 100;
    for (const b of t.buildings) {
      const out = b.level * ctrl;
      switch (b.type) {
        case "FARM":
          food += out * 2;
          break;
        case "POWER_PLANT":
          electricity += out * 3;
          break;
        case "FACTORY":
          steel += out * 1.5;
          break;
      }
    }
    // Baseline extraction so resource-light starts still tick.
    oil += 0.05 * ctrl;
  }
  return { food, electricity, steel, oil };
}

function totalForceStrength(c: Country): number {
  // Placeholder until Phase 4 wires live force aggregation; military budget acts
  // as a proxy upkeep driver so the spam-punishing curve is already in effect.
  return (c.gdp * (c.militaryBudgetPct / 100)) / 50;
}

// ── MORALE & STABILITY ──────────────────────────────────────────────────
function stepMorale(
  c: CountryFull,
  dtMs: number,
  gameId: string,
  events: Prisma.GameEventCreateManyInput[]
): void {
  const dtScale = dtMs / 60_000;
  const taxPenalty =
    Math.max(0, c.taxRate - MORALE.comfortableTax) * MORALE.taxPenaltyPerPoint;
  const foodShort = c.food < 0 ? MORALE.foodShortagePenalty : 0;

  let aggMorale = 0;
  for (const t of c.territories) {
    const occ = t.occupied ? MORALE.occupationPenalty : 0;
    const target = 60 - taxPenalty * 10 - foodShort * 5 - occ * 5;
    t.morale += (target - t.morale) * MORALE.driftToTarget * dtScale * 0.1;

    // Unrest rises when morale is low, eases when content.
    t.unrest += (t.morale < 35 ? 0.4 : -0.2) * dtScale;
    t.unrest = clamp(t.unrest);

    if (t.unrest >= MORALE.secessionUnrest && t.controlPct >= 100 && !t.occupied) {
      events.push({
        gameId,
        scope: "COUNTRY",
        category: "POLITICAL_INSTABILITY",
        title: `${t.name} is in open revolt`,
        body: `Unrest in ${t.name} has reached breaking point. Separatists are organising.`,
        countryIso: c.iso3,
        severity: 3,
      });
      t.unrest = 60; // vent pressure; full secession handled in Phase 4/6
    }
    aggMorale += t.morale;
  }

  if (c.territories.length) c.morale = aggMorale / c.territories.length;
  // Stability tracks morale and treasury health.
  const stabTarget = c.morale * 0.7 + (c.money >= 0 ? 30 : 0);
  c.stability += (stabTarget - c.stability) * 0.05 * dtScale * 0.1;
}

// ── WORLD EVENTS ──────────────────────────────────────────────────────────
function rollWorldEvent(
  countries: CountryFull[],
  gameId: string,
  rng: () => number,
  clock: Date,
  events: Prisma.GameEventCreateManyInput[]
): void {
  if (rng() > WORLD_EVENTS.chancePerRoll) return;
  const kinds = [
    "RECESSION",
    "PANDEMIC",
    "REFUGEE_CRISIS",
    "OIL_SHORTAGE",
    "NATURAL_DISASTER",
    "CYBER_ATTACK",
  ] as const;
  const kind = kinds[Math.floor(rng() * kinds.length)];

  if (kind === "RECESSION") {
    for (const c of countries) c.gdp *= 0.985;
    events.push({
      gameId,
      scope: "GLOBAL",
      category: "RECESSION",
      title: "Global recession",
      body: "Markets contract worldwide. GDP takes a hit across all nations.",
      severity: 2,
    });
    return;
  }

  // Country-scoped events hit a random nation.
  const c = countries[Math.floor(rng() * countries.length)];
  if (!c) return;
  const map: Record<string, { title: string; apply: () => void }> = {
    PANDEMIC: { title: `Pandemic outbreak in ${c.name}`, apply: () => (c.morale -= 10) },
    REFUGEE_CRISIS: { title: `Refugee crisis pressures ${c.name}`, apply: () => (c.stability -= 8) },
    OIL_SHORTAGE: { title: `Oil shortage hits ${c.name}`, apply: () => (c.oil *= 0.5) },
    NATURAL_DISASTER: { title: `Natural disaster strikes ${c.name}`, apply: () => (c.gdp *= 0.97) },
    CYBER_ATTACK: { title: `Cyber attack targets ${c.name}`, apply: () => (c.stability -= 5) },
  };
  const e = map[kind];
  e.apply();
  events.push({
    gameId,
    scope: "COUNTRY",
    category: kind as GameEvent["category"],
    title: e.title,
    countryIso: c.iso3,
    severity: 2,
  });
}

// ── TIMER COMPLETIONS (construction, research) ─────────────────────────────
async function resolveCompletions(
  gameId: string,
  now: Date,
  events: Prisma.GameEventCreateManyInput[]
): Promise<void> {
  const doneBuildings = await prisma.building.findMany({
    where: { completesAt: { lte: now }, territory: { country: { gameId } } },
    include: { territory: { include: { country: true } } },
  });
  for (const b of doneBuildings) {
    await prisma.building.update({
      where: { id: b.id },
      data: { level: b.buildingToLevel ?? b.level + 1, buildingToLevel: null, completesAt: null },
    });
    events.push({
      gameId,
      scope: "COUNTRY",
      category: "CONSTRUCTION",
      title: `${b.type} completed in ${b.territory.name}`,
      countryIso: b.territory.country.iso3,
      severity: 1,
    });
  }

  const doneResearch = await prisma.researchProject.findMany({
    where: { completesAt: { lte: now }, completed: false, country: { gameId } },
    include: { country: true },
  });
  for (const r of doneResearch) {
    await prisma.researchProject.update({
      where: { id: r.id },
      data: { completed: true, progress: 100, completesAt: null },
    });
    events.push({
      gameId,
      scope: "COUNTRY",
      category: "RESEARCH",
      title: `Research complete: ${r.techKey}`,
      countryIso: r.country.iso3,
      severity: 1,
    });
  }
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
