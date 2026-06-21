import { prisma } from "@/lib/db";
import { catchUp } from "@/lib/sim/engine";
import { TECH_TREE } from "@/data/tech";
import { FOG } from "@/lib/balance";
import { UNIT_STATS } from "@/lib/units";

export interface CountryDot {
  iso3: string;
  name: string;
  lng: number;
  lat: number;
  gdp: number;
  isPlayer: boolean;
  isAlive: boolean;
  atWar: boolean; // at war with the player
  combatant: boolean; // involved in any active war
}

export interface BuildingView {
  type: string;
  level: number;
  buildingToLevel: number | null;
  completesAt: string | null;
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
  buildings: BuildingView[];
}

export interface ArmyView {
  id: string;
  name: string;
  state: string;
  strength: number;
  morale: number;
  locationTerritoryId: string | null;
  strikeReadyAt: string | null;
  units: { type: string; count: number; health: number }[];
}

export interface FleetView {
  id: string;
  name: string;
  lng: number;
  lat: number;
  state: string;
  strength: number;
  strikeReadyAt: string | null;
  units: { type: string; count: number }[];
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
  game: { ageDays: number; paused: boolean; speed: number };
  rankings: { gdp: number; influence: number; territory: number; total: number };
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
  // Every zone in the world with its current owner — drives the hex map colours.
  allZones: { id: string; name: string; lng: number; lat: number; ownerIso: string; homeIso: string; kind: string; controlPct: number; visible: boolean }[];
  // Enemy units currently within your vision range.
  enemyUnits: { lng: number; lat: number; type: string; ownerIso: string }[];
  armies: ArmyView[];
  fleets: FleetView[];
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

  // Player's own sectors enriched with their buildings (for the territory panel).
  const playerTerritories = await prisma.territory.findMany({
    where: { countryId: player.id },
    include: { buildings: true },
    orderBy: { population: "desc" },
  });

  const [armies, fleets, relations, wars, tradeRoutes, research] = await Promise.all([
    prisma.army.findMany({ where: { countryId: player.id }, include: { units: true } }),
    prisma.fleet.findMany({ where: { countryId: player.id }, include: { units: true } }),
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

  // War status for colouring the map: who's fighting, and who's fighting us.
  const allWars = await prisma.war.findMany({
    where: { gameId, status: "ACTIVE" },
    include: { participants: { select: { countryId: true } } },
  });
  const combatantIds = new Set<string>();
  const playerEnemyIds = new Set<string>();
  for (const w of allWars) {
    const ids = w.participants.map((p) => p.countryId);
    const hasPlayer = ids.includes(player.id);
    for (const id of ids) {
      combatantIds.add(id);
      if (hasPlayer && id !== player.id) playerEnemyIds.add(id);
    }
  }

  const takenTech = new Set(research.map((r) => r.techKey));

  // ── Fog of war: what can the player see? ──
  const zonePos = new Map<string, [number, number]>();
  for (const c of countries) for (const t of c.territories) zonePos.set(t.id, [t.lng, t.lat]);

  // Vision sources: each controlled zone (radar extends it) + each army.
  const sources: { x: number; y: number; r2: number }[] = [];
  for (const t of playerTerritories) {
    const radar = t.buildings.some((b) => b.type === "RADAR" && b.level >= 1);
    const r = radar ? FOG.radarSight : FOG.zoneSight;
    sources.push({ x: t.lng, y: t.lat, r2: r * r });
  }
  const allArmies = await prisma.army.findMany({
    where: { country: { gameId } },
    include: { units: true, country: { select: { iso3: true, isPlayer: true } } },
  });
  for (const a of allArmies) {
    if (!a.country.isPlayer || !a.locationTerritoryId) continue;
    const pos = zonePos.get(a.locationTerritoryId);
    if (!pos) continue;
    const sight = Math.max(FOG.armyMinSight, ...a.units.map((u) => UNIT_STATS[u.type].sight));
    sources.push({ x: pos[0], y: pos[1], r2: sight * sight });
  }
  const seen = (x: number, y: number) =>
    sources.some((s) => (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) <= s.r2);

  // Enemy units within vision.
  const enemyUnits: WorldSnapshot["enemyUnits"] = [];
  for (const a of allArmies) {
    if (a.country.isPlayer || !a.locationTerritoryId) continue;
    const pos = zonePos.get(a.locationTerritoryId);
    if (!pos || !seen(pos[0], pos[1])) continue;
    const dominant = [...a.units].sort((x, y) => y.count - x.count)[0]?.type ?? "INFANTRY";
    enemyUnits.push({ lng: pos[0], lat: pos[1], type: dominant, ownerIso: a.country.iso3 });
  }

  // Player standing among living nations.
  const alive = countries.filter((c) => c.isAlive);
  const rankBy = (val: (c: (typeof alive)[number]) => number) =>
    1 + alive.filter((c) => val(c) > val(player)).length;
  const rankings = {
    gdp: rankBy((c) => c.gdp),
    influence: rankBy((c) => c.influence),
    territory: rankBy((c) => c.territories.length),
    total: alive.length,
  };

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
    game: {
      ageDays: (Date.now() - game.createdAt.getTime()) / 86_400_000,
      paused: game.paused,
      speed: game.speed,
    },
    rankings,
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
    territories: playerTerritories.map((t) => ({
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
      buildings: t.buildings.map((b) => ({
        type: b.type,
        level: b.level,
        buildingToLevel: b.buildingToLevel,
        completesAt: b.completesAt ? b.completesAt.toISOString() : null,
      })),
    })),
    countries: countries.map((c) => ({
      iso3: c.iso3,
      name: c.name,
      lng: c.capitalLng,
      lat: c.capitalLat,
      gdp: c.gdp,
      isPlayer: c.isPlayer,
      isAlive: c.isAlive,
      atWar: playerEnemyIds.has(c.id),
      combatant: combatantIds.has(c.id),
    })),
    allZones: countries.flatMap((c) =>
      c.territories.map((t) => {
        const visible = c.id === player.id || seen(t.lng, t.lat);
        return {
          id: t.id,
          name: t.name,
          lng: t.lng,
          lat: t.lat,
          ownerIso: visible ? c.iso3 : "", // fogged: owner unknown
          homeIso: t.originalOwner,
          kind: t.kind,
          controlPct: t.controlPct,
          visible,
        };
      })
    ),
    enemyUnits,
    armies: armies.map((a) => ({
      id: a.id,
      name: a.name,
      state: a.state,
      strength: a.strength,
      morale: a.morale,
      locationTerritoryId: a.locationTerritoryId,
      strikeReadyAt: a.strikeReadyAt ? a.strikeReadyAt.toISOString() : null,
      units: a.units.map((u) => ({ type: u.type, count: u.count, health: u.health })),
    })),
    fleets: fleets.map((f) => ({
      id: f.id,
      name: f.name,
      lng: f.lng,
      lat: f.lat,
      state: f.state,
      strength: f.strength,
      strikeReadyAt: f.strikeReadyAt ? f.strikeReadyAt.toISOString() : null,
      units: f.units.map((u) => ({ type: u.type, count: u.count })),
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
