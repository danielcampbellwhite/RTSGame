import { prisma } from "@/lib/db";
import { catchUp } from "@/lib/sim/engine";
import { TECH_TREE } from "@/data/tech";

export interface CountryDot {
  iso3: string;
  name: string;
  lng: number;
  lat: number;
  gdp: number;
  isPlayer: boolean;
  isAlive: boolean;
}

export interface TerritoryView {
  id: string;
  name: string;
  kind: string;
  lng: number;
  lat: number;
  population: number;
  morale: number;
  unrest: number;
  controlPct: number;
  occupied: boolean;
}

export interface ArmyView {
  id: string;
  name: string;
  state: string;
  strength: number;
  morale: number;
  locationTerritoryId: string | null;
  units: { type: string; count: number; health: number }[];
}

export interface RelationView {
  iso3: string;
  name: string;
  opinion: number;
  atWar: boolean;
  allied: boolean;
  embargo: boolean;
}

export interface WarView {
  id: string;
  name: string;
  attackers: string[];
  defenders: string[];
}

export interface WarTargetView {
  warId: string;
  enemyIso: string;
  enemyName: string;
  territoryId: string;
  territoryName: string;
  lng: number;
  lat: number;
}

export interface TradeRouteView {
  id: string;
  fromIso: string;
  toIso: string;
  good: string;
  ratePerDay: number;
  blockaded: boolean;
}

export interface ResearchView {
  techKey: string;
  name: string;
  category: string;
  progress: number;
  completed: boolean;
}

export interface WorldSnapshot {
  gameId: string;
  player: {
    id: string;
    iso3: string;
    name: string;
    gdp: number;
    population: number;
    stability: number;
    morale: number;
    influence: number;
    techLevel: number;
    infrastructure: number;
    taxRate: number;
    militaryBudgetPct: number;
    welfareBudgetPct: number;
    infraBudgetPct: number;
    researchBudgetPct: number;
    resources: {
      money: number;
      oil: number;
      food: number;
      electricity: number;
      steel: number;
      rareMaterials: number;
      manpower: number;
    };
  };
  territories: TerritoryView[];
  countries: CountryDot[];
  armies: ArmyView[];
  relations: RelationView[];
  wars: WarView[];
  warTargets: WarTargetView[];
  tradeRoutes: TradeRouteView[];
  research: ResearchView[];
  availableTech: { key: string; name: string; category: string; days: number; requires: string[] }[];
  events: { id: string; title: string; category: string; severity: number; createdAt: string }[];
}

/** Catch the world up to now, then return everything the command center needs. */
export async function getWorldSnapshot(gameId: string): Promise<WorldSnapshot | null> {
  await catchUp(gameId);

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return null;

  const countries = await prisma.country.findMany({
    where: { gameId },
    include: { territories: true },
  });
  const player = countries.find((c) => c.isPlayer);
  if (!player) return null;

  const events = await prisma.gameEvent.findMany({
    where: { gameId },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const [armies, relations, wars, tradeRoutes, research] = await Promise.all([
    prisma.army.findMany({ where: { countryId: player.id }, include: { units: true } }),
    prisma.diplomaticRelation.findMany({ where: { fromId: player.id }, include: { to: true } }),
    prisma.war.findMany({
      where: { gameId, status: "ACTIVE", participants: { some: { countryId: player.id } } },
      include: { participants: { include: { country: true } } },
    }),
    prisma.tradeRoute.findMany({
      where: { OR: [{ fromId: player.id }, { toId: player.id }] },
      include: { from: true, to: true },
    }),
    prisma.researchProject.findMany({ where: { countryId: player.id } }),
  ]);

  const takenTech = new Set(research.map((r) => r.techKey));

  // War targets: each enemy's capital sector, for "attack" orders & map markers.
  const warTargets: WorldSnapshot["warTargets"] = [];
  for (const w of wars) {
    for (const p of w.participants) {
      if (p.countryId === player.id) continue;
      const cap = await prisma.territory.findFirst({
        where: { countryId: p.countryId, kind: "CAPITAL" },
      });
      if (cap) {
        warTargets.push({
          warId: w.id,
          enemyIso: p.country.iso3,
          enemyName: p.country.name,
          territoryId: cap.id,
          territoryName: cap.name,
          lng: cap.lng,
          lat: cap.lat,
        });
      }
    }
  }

  return {
    gameId,
    player: {
      id: player.id,
      iso3: player.iso3,
      name: player.name,
      gdp: player.gdp,
      population: player.population,
      stability: player.stability,
      morale: player.morale,
      influence: player.influence,
      techLevel: player.techLevel,
      infrastructure: player.infrastructure,
      taxRate: player.taxRate,
      militaryBudgetPct: player.militaryBudgetPct,
      welfareBudgetPct: player.welfareBudgetPct,
      infraBudgetPct: player.infraBudgetPct,
      researchBudgetPct: player.researchBudgetPct,
      resources: {
        money: player.money,
        oil: player.oil,
        food: player.food,
        electricity: player.electricity,
        steel: player.steel,
        rareMaterials: player.rareMaterials,
        manpower: player.manpower,
      },
    },
    territories: player.territories.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      lng: t.lng,
      lat: t.lat,
      population: t.population,
      morale: t.morale,
      unrest: t.unrest,
      controlPct: t.controlPct,
      occupied: t.occupied,
    })),
    countries: countries.map((c) => ({
      iso3: c.iso3,
      name: c.name,
      lng: c.capitalLng,
      lat: c.capitalLat,
      gdp: c.gdp,
      isPlayer: c.isPlayer,
      isAlive: c.isAlive,
    })),
    armies: armies.map((a) => ({
      id: a.id,
      name: a.name,
      state: a.state,
      strength: a.strength,
      morale: a.morale,
      locationTerritoryId: a.locationTerritoryId,
      units: a.units.map((u) => ({ type: u.type, count: u.count, health: u.health })),
    })),
    relations: relations.map((r) => ({
      iso3: r.to.iso3,
      name: r.to.name,
      opinion: r.opinion,
      atWar: r.atWar,
      allied: r.allied,
      embargo: r.embargo,
    })),
    wars: wars.map((w) => ({
      id: w.id,
      name: w.name,
      attackers: w.participants.filter((p) => p.attacker).map((p) => p.country.iso3),
      defenders: w.participants.filter((p) => !p.attacker).map((p) => p.country.iso3),
    })),
    warTargets,
    tradeRoutes: tradeRoutes.map((t) => ({
      id: t.id,
      fromIso: t.from.iso3,
      toIso: t.to.iso3,
      good: t.good,
      ratePerDay: t.ratePerDay,
      blockaded: t.blockaded,
    })),
    research: research.map((r) => ({
      techKey: r.techKey,
      name: TECH_TREE.find((t) => t.key === r.techKey)?.name ?? r.techKey,
      category: r.category,
      progress: r.progress,
      completed: r.completed,
    })),
    availableTech: TECH_TREE.filter((t) => !takenTech.has(t.key)).map((t) => ({
      key: t.key,
      name: t.name,
      category: t.category,
      days: t.days,
      requires: t.requires ?? [],
    })),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      severity: e.severity,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
