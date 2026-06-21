import { prisma } from "@/lib/db";
import { TICK, ECONOMY, MORALE, WORLD_EVENTS, RESEARCH, BUDGET } from "@/lib/balance";
import { forceStrength } from "@/lib/units";
import { TECH_BY_KEY, type TechNode } from "@/data/tech";
import { stepTrade } from "@/lib/sim/trade";
import { stepCombat, type SimArmy, type CombatContext } from "@/lib/sim/combat";
import { runAI } from "@/lib/sim/ai";
import { endWar } from "@/lib/sim/diplomacy";
import type {
  Country,
  Territory,
  Building,
  GameEvent,
  TradeRoute,
  ResearchProject,
  Prisma,
} from "@prisma/client";

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
 * Advance one game's world to now. Single code path for on-read catch-up and the
 * cron tick. Continuous systems (economy, trade, research, combat) integrate in
 * memory and persist in bulk; discrete strategic AI runs afterwards on fresh state.
 */
export async function catchUp(gameId: string, now: Date = new Date()): Promise<void> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.paused) return;

  // The player's chosen speed multiplies how much simulation time elapses per
  // real second. Pause is handled above by skipping (and the unpause action
  // resets lastTickAt so paused wall-clock time is never simulated).
  const elapsedMs = (now.getTime() - game.lastTickAt.getTime()) * (game.speed || 1);
  if (elapsedMs < TICK.stepMs) return;

  const steps = Math.min(Math.floor(elapsedMs / TICK.stepMs), TICK.maxSteps);
  const stepMs = elapsedMs / steps;
  const rng = mulberry32(game.lastTickAt.getTime() & 0xffffffff);

  // The simulation clock advances by the (speed-scaled) elapsed time. All
  // discrete deadlines (construction, research, arrivals, cooldowns) live on
  // this clock, so pausing freezes them and speed accelerates them.
  const simStart = game.simClock.getTime();
  const simEndDate = new Date(simStart + elapsedMs);

  const countries = (await prisma.country.findMany({
    where: { gameId, isAlive: true },
    include: { territories: { include: { buildings: true } } },
  })) as CountryFull[];
  const armies = (await prisma.army.findMany({
    where: { country: { gameId } },
    include: { units: true },
  })) as SimArmy[];
  const fleets = await prisma.fleet.findMany({ where: { country: { gameId } }, include: { units: true } });
  const routes: TradeRoute[] = await prisma.tradeRoute.findMany({ where: { from: { gameId } } });
  const research: ResearchProject[] = await prisma.researchProject.findMany({
    where: { country: { gameId }, completed: false },
  });

  // ── Indexes ──
  const countriesById = new Map(countries.map((c) => [c.id, c]));
  const isoByCountryId = new Map(countries.map((c) => [c.id, c.iso3]));
  const territoriesById = new Map<string, Territory>();
  const forceByCountry = new Map<string, number>();
  for (const c of countries) for (const t of c.territories) territoriesById.set(t.id, t);
  for (const a of armies) {
    a.strength = forceStrength(a.units);
    forceByCountry.set(a.countryId, (forceByCountry.get(a.countryId) ?? 0) + a.strength);
  }
  // Fleets: recompute strength (for upkeep) and resolve sea movement arrivals.
  for (const f of fleets) {
    f.strength = forceStrength(f.units);
    forceByCountry.set(f.countryId, (forceByCountry.get(f.countryId) ?? 0) + f.strength);
    if (f.state === "MOVING" && f.arrivesAt && f.arrivesAt.getTime() <= simEndDate.getTime()) {
      f.lng = f.targetLng ?? f.lng;
      f.lat = f.targetLat ?? f.lat;
      f.targetLng = null;
      f.targetLat = null;
      f.arrivesAt = null;
      f.state = "IDLE";
    }
  }

  const events: Prisma.GameEventCreateManyInput[] = [];
  const captures = new Map<string, string>();

  // ── Resolve arrivals up front so combat can engage this window. ──
  for (const a of armies) {
    if (a.state === "MOVING" && a.arrivesAt && a.arrivesAt.getTime() <= simEndDate.getTime()) {
      a.locationTerritoryId = a.targetTerritoryId;
      a.targetTerritoryId = null;
      a.arrivesAt = null;
      const terr = a.locationTerritoryId ? territoriesById.get(a.locationTerritoryId) : null;
      a.state = terr && terr.countryId !== a.countryId ? "ENGAGED" : "IDLE";
    }
  }
  const armiesByTerritory = new Map<string, SimArmy[]>();
  for (const a of armies)
    if (a.locationTerritoryId) {
      const list = armiesByTerritory.get(a.locationTerritoryId) ?? [];
      list.push(a);
      armiesByTerritory.set(a.locationTerritoryId, list);
    }
  const combatCtx: CombatContext = {
    territoriesById,
    armiesByTerritory,
    captures,
    events,
    isoByCountryId,
    gameId,
  };

  // ── Integrate ──
  for (let i = 1; i <= steps; i++) {
    const stepClock = new Date(simStart + i * stepMs);

    if (i % TICK.economyEverySteps === 0) {
      const dt = stepMs * TICK.economyEverySteps;
      for (const c of countries) stepEconomy(c, dt, forceByCountry.get(c.id) ?? 0);
      for (const c of countries) stepMorale(c, dt, gameId, events);
      stepTrade(routes, countriesById, dt);
      stepResearch(research, countriesById, dt);
    }

    stepCombat(armies, stepMs, combatCtx);

    if (i % TICK.worldEventEverySteps === 0) rollWorldEvent(countries, gameId, rng, stepClock, events);
  }

  const completedTech = await resolveCompletions(gameId, simEndDate, countriesById, research, events);

  // ── Persist continuous state ──
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
          infrastructure: clamp(c.infrastructure),
        },
      })
    ),
    ...countries.flatMap((c) =>
      c.territories.map((t) =>
        prisma.territory.update({
          where: { id: t.id },
          data: {
            morale: clamp(t.morale),
            unrest: clamp(t.unrest),
            economy: clamp(t.economy),
            controlPct: clamp(t.controlPct),
            occupied: t.occupied,
            defenses: t.defenses,
            countryId: t.countryId,
          },
        })
      )
    ),
    ...armies.map((a) =>
      prisma.army.update({
        where: { id: a.id },
        data: {
          strength: a.strength,
          morale: clamp(a.morale),
          supply: clamp(a.supply),
          state: a.state,
          locationTerritoryId: a.locationTerritoryId,
          targetTerritoryId: a.targetTerritoryId,
          arrivesAt: a.arrivesAt,
        },
      })
    ),
    ...armies.flatMap((a) =>
      a.units.map((u) => prisma.unit.update({ where: { id: u.id }, data: { health: clamp(u.health) } }))
    ),
    ...fleets.map((f) =>
      prisma.fleet.update({
        where: { id: f.id },
        data: { strength: f.strength, state: f.state, lng: f.lng, lat: f.lat, targetLng: f.targetLng, targetLat: f.targetLat, arrivesAt: f.arrivesAt },
      })
    ),
    ...research.map((r) => prisma.researchProject.update({ where: { id: r.id }, data: { progress: clamp(r.progress) } })),
    ...completedTech.map((id) =>
      prisma.researchProject.update({ where: { id }, data: { completed: true, progress: 100, completesAt: null } })
    ),
    ...(events.length ? [prisma.gameEvent.createMany({ data: events })] : []),
    prisma.game.update({ where: { id: gameId }, data: { lastTickAt: now, simClock: simEndDate } }),
  ]);

  // ── Discrete passes (own reads/writes) ──
  await checkCollapse(gameId);
  await runAI(gameId, rng, simEndDate);
}

// ── ECONOMY ──────────────────────────────────────────────────────────────
function stepEconomy(c: CountryFull, dtMs: number, militaryStrength: number): void {
  const dtScale = dtMs / 60_000;
  const dayFrac = dtScale / BUDGET.minutesPerDay;
  const efficiency = (c.stability / 100) * 0.6 + (c.infrastructure / 100) * 0.4;
  const revenue = c.gdp * (c.taxRate / 100) * ECONOMY.baseTaxYield * efficiency * dtScale;

  // Real military upkeep, super-linear to punish unit spam.
  const upkeep = Math.pow(militaryStrength, ECONOMY.upkeepExponent) * ECONOMY.upkeepPerStrength * dtScale;

  // Discretionary spending: every budget lever draws from the treasury, so tax
  // (income) must cover military + welfare + infrastructure + research (outlays).
  const spendPct = (c.militaryBudgetPct + c.welfareBudgetPct + c.infraBudgetPct + c.researchBudgetPct) / 100;
  const spending = c.gdp * spendPct * BUDGET.spendPerDayAt100 * dayFrac;

  c.money += revenue - upkeep - spending;

  // Military budget mobilises manpower (capped at the total population pool).
  c.manpower = Math.min(
    c.population,
    c.manpower + c.population * (c.militaryBudgetPct / 100) * BUDGET.mobilizationPerDayAt100 * dayFrac
  );
  // Infrastructure budget sustains the national infrastructure level (which
  // feeds economic efficiency above) by drifting it toward the allocation.
  c.infrastructure = clamp(c.infrastructure + (c.infraBudgetPct - c.infrastructure) * BUDGET.infraDriftPerDay * dayFrac);

  const prod = buildingProduction(c);
  c.food += prod.food * dtScale;
  c.electricity += prod.electricity * dtScale;
  c.steel += prod.steel * dtScale;
  c.oil += prod.oil * dtScale;

  const growth = ECONOMY.gdpGrowthBase * efficiency * dtScale;
  c.gdp *= 1 + growth;
  if (c.money < 0) c.gdp *= 1 - ECONOMY.deficitInflationRate * dtScale;
}

function buildingProduction(c: CountryFull) {
  let food = 0,
    electricity = 0,
    steel = 0,
    oil = 0;
  for (const t of c.territories) {
    if (t.countryId !== c.id) continue; // lost sectors don't pay this owner
    const ctrl = t.controlPct / 100;
    for (const b of t.buildings) {
      const out = b.level * ctrl;
      if (b.type === "FARM") food += out * 2;
      else if (b.type === "POWER_PLANT") electricity += out * 3;
      else if (b.type === "FACTORY") steel += out * 1.5;
    }
    oil += 0.05 * ctrl;
  }
  return { food, electricity, steel, oil };
}

// ── MORALE & STABILITY ─────────────────────────────────────────────────────
function stepMorale(
  c: CountryFull,
  dtMs: number,
  gameId: string,
  events: Prisma.GameEventCreateManyInput[]
): void {
  const dtScale = dtMs / 60_000;
  const taxPenalty = Math.max(0, c.taxRate - MORALE.comfortableTax) * MORALE.taxPenaltyPerPoint;
  const foodShort = c.food < 0 ? MORALE.foodShortagePenalty : 0;
  // Welfare spending lifts the baseline the population settles toward.
  const welfareBoost = (c.welfareBudgetPct / 100) * BUDGET.welfareMoraleAt100;

  let aggMorale = 0;
  let owned = 0;
  for (const t of c.territories) {
    if (t.countryId !== c.id) continue;
    owned++;
    const occ = t.occupied ? MORALE.occupationPenalty : 0;
    const target = 60 + welfareBoost - taxPenalty * 10 - foodShort * 5 - occ * 5;
    t.morale += (target - t.morale) * MORALE.driftToTarget * dtScale * 0.1;
    t.unrest += (t.morale < 35 ? 0.4 : -0.2) * dtScale;
    t.unrest = clamp(t.unrest);

    if (t.unrest >= MORALE.secessionUnrest && !t.occupied) {
      events.push({
        gameId,
        scope: "COUNTRY",
        category: "POLITICAL_INSTABILITY",
        title: `${t.name} is in open revolt`,
        countryIso: c.iso3,
        severity: 3,
      });
      t.unrest = 60;
    }
    aggMorale += t.morale;
  }

  if (owned) c.morale = aggMorale / owned;
  const stabTarget = c.morale * 0.7 + (c.money >= 0 ? 30 : 0);
  c.stability += (stabTarget - c.stability) * 0.05 * dtScale * 0.1;
}

// ── RESEARCH PROGRESS ───────────────────────────────────────────────────────
function stepResearch(research: ResearchProject[], countriesById: Map<string, Country>, dtMs: number): void {
  const dt = dtMs / 60_000;
  for (const r of research) {
    const c = countriesById.get(r.countryId);
    if (!c) continue;
    r.progress = Math.min(100, r.progress + RESEARCH.baseProgressPerMin * (c.researchBudgetPct / 100) * dt);
  }
}

// ── WORLD EVENTS ────────────────────────────────────────────────────────────
function rollWorldEvent(
  countries: CountryFull[],
  gameId: string,
  rng: () => number,
  _clock: Date,
  events: Prisma.GameEventCreateManyInput[]
): void {
  if (rng() > WORLD_EVENTS.chancePerRoll) return;
  const kinds = ["RECESSION", "PANDEMIC", "REFUGEE_CRISIS", "OIL_SHORTAGE", "NATURAL_DISASTER", "CYBER_ATTACK"] as const;
  const kind = kinds[Math.floor(rng() * kinds.length)];

  if (kind === "RECESSION") {
    for (const c of countries) c.gdp *= 0.985;
    events.push({ gameId, scope: "GLOBAL", category: "RECESSION", title: "Global recession", severity: 2 });
    return;
  }
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
  events.push({ gameId, scope: "COUNTRY", category: kind as GameEvent["category"], title: e.title, countryIso: c.iso3, severity: 2 });
}

// ── TIMER COMPLETIONS ───────────────────────────────────────────────────────
async function resolveCompletions(
  gameId: string,
  now: Date,
  countriesById: Map<string, Country>,
  research: ResearchProject[],
  events: Prisma.GameEventCreateManyInput[]
): Promise<string[]> {
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

  // Research that crosses its completion time this window: apply the tech effect.
  const completedTech: string[] = [];
  for (const r of research) {
    if (r.completesAt && r.completesAt.getTime() <= now.getTime()) {
      const node = TECH_BY_KEY[r.techKey];
      const c = countriesById.get(r.countryId);
      if (node && c) applyTech(c, node);
      completedTech.push(r.id);
      events.push({
        gameId,
        scope: "COUNTRY",
        category: "RESEARCH",
        title: `Research complete: ${node?.name ?? r.techKey}`,
        countryIso: c?.iso3,
        severity: 2,
      });
    }
  }
  return completedTech;
}

/** One-time application of a completed tech's effect to a country. */
function applyTech(c: Country, node: TechNode): void {
  const e = node.effect;
  if (e.gdpGrowthMult) c.gdp *= 1 + (e.gdpGrowthMult - 1) * 0.5;
  if (e.moraleBonus) c.morale = clamp(c.morale + e.moraleBonus);
  if (e.resourceYieldMult) {
    c.steel *= e.resourceYieldMult;
    c.electricity *= e.resourceYieldMult;
  }
  if (e.researchSpeedMult) c.techLevel = clamp(c.techLevel + 3);
  if (e.unitStrengthMult) c.techLevel = clamp(c.techLevel + 4);
}

// ── COLLAPSE / WAR RESOLUTION ───────────────────────────────────────────────
async function checkCollapse(gameId: string): Promise<void> {
  const countries = await prisma.country.findMany({ where: { gameId, isAlive: true } });
  // A country stays alive only while it still owns sectors.
  for (const c of countries) {
    const owned = await prisma.territory.count({ where: { countryId: c.id } });
    if (owned === 0) {
      await prisma.country.update({ where: { id: c.id }, data: { isAlive: false } });
      await prisma.gameEvent.create({
        data: { gameId, scope: "GLOBAL", category: "POLITICAL_INSTABILITY", title: `${c.name} has collapsed`, countryIso: c.iso3, severity: 3 },
      });
    }
  }

  // End wars with fewer than two living participants.
  const wars = await prisma.war.findMany({ where: { gameId, status: "ACTIVE" }, include: { participants: { include: { country: true } } } });
  for (const w of wars) {
    const living = w.participants.filter((p) => p.country.isAlive).length;
    if (living < 2) await endWar(w.id);
  }
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
