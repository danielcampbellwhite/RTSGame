import { prisma } from "@/lib/db";
import { catchUp } from "@/lib/sim/engine";

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

export interface WorldSnapshot {
  gameId: string;
  player: {
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

  return {
    gameId,
    player: {
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
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      severity: e.severity,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
