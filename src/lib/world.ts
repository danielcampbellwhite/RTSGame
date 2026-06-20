import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { COUNTRIES, KNOWN_SECTORS, type CountrySeed } from "@/data/countries";
import { forceStrength } from "@/lib/units";
import type { Prisma, TerritoryKind, UnitType } from "@prisma/client";

// Historic rivalries seeded with negative opinion so aggressive AI has targets.
const RIVALRIES: [string, string][] = [
  ["USA", "RUS"], ["USA", "CHN"], ["CHN", "IND"], ["IND", "PAK"], ["RUS", "UKR"],
  ["ISR", "IRN"], ["KOR", "PRK"], ["GRC", "TUR"], ["SAU", "IRN"], ["JPN", "CHN"],
];

/**
 * Build a fresh world (one save): the player's country plus every AI nation with
 * territories, buildings, a starting army and rivalries.
 *
 * IDs are generated up front so the entire world is written in a handful of
 * batched `createMany` calls rather than ~140 sequential inserts — this keeps
 * world creation comfortably inside a serverless function timeout.
 */
export async function createGameWorld(
  playerIso: string,
  playerName = "Commander",
  playerEmail?: string
): Promise<string> {
  const gameId = randomUUID();

  const countries: Prisma.CountryCreateManyInput[] = [];
  const territories: Prisma.TerritoryCreateManyInput[] = [];
  const buildings: Prisma.BuildingCreateManyInput[] = [];
  const armies: Prisma.ArmyCreateManyInput[] = [];
  const units: Prisma.UnitCreateManyInput[] = [];
  const relations: Prisma.DiplomaticRelationCreateManyInput[] = [];
  const idByIso = new Map<string, string>();

  for (const seed of COUNTRIES) {
    const countryId = randomUUID();
    idByIso.set(seed.iso3, countryId);
    const isPlayer = seed.iso3 === playerIso;
    const superScale = seed.super ? 1.4 : 1;

    countries.push({
      id: countryId,
      gameId,
      iso3: seed.iso3,
      name: seed.name,
      capitalLng: seed.capital[0],
      capitalLat: seed.capital[1],
      isPlayer,
      population: seed.population,
      gdp: seed.gdp,
      stability: clamp(45 + Math.log10(seed.gdp + 1) * 6),
      techLevel: clamp(30 + Math.log10(seed.gdp + 1) * 8 * superScale),
      influence: clamp(Math.log10(seed.gdp + 1) * 8 * superScale),
      morale: 60,
      infrastructure: clamp(40 + Math.log10(seed.gdp + 1) * 5),
      money: seed.gdp * 0.05,
      oil: seed.gdp * 0.01,
      food: seed.population * 0.5,
      electricity: seed.population * 0.4,
      steel: seed.gdp * 0.005,
      rareMaterials: seed.gdp * 0.001,
      manpower: seed.population * 0.3,
      aiAggression: seed.aggression ?? 40,
      aiEconomyFocus: 50,
      aiMilitaryFocus: seed.super ? 60 : 40,
      aiDiplomacyPref: seed.super ? 45 : 60,
      aiRiskTolerance: seed.super ? 55 : 40,
    });

    // Territories + their starting buildings.
    let capitalTerritoryId: string | null = null;
    for (const t of sectorsFor(seed)) {
      const territoryId = randomUUID();
      if (t.kind === "CAPITAL") capitalTerritoryId = territoryId;
      territories.push({
        id: territoryId,
        countryId,
        name: t.name,
        kind: t.kind,
        lng: t.lng,
        lat: t.lat,
        population: t.population,
        originalOwner: seed.iso3,
        defenses: t.kind === "CAPITAL" ? 30 : 10,
        economy: 50,
        morale: 60,
        infrastructure: 50,
      });
      for (const b of startingBuildings(t.kind)) buildings.push({ territoryId, type: b.type, level: b.level });
    }

    // Starting army at the capital.
    const armyId = randomUUID();
    const infantry = Math.max(2, Math.floor(seed.gdp / 300) + 2);
    const tanks = seed.super ? Math.floor(seed.gdp / 1500) + 1 : 0;
    const armyUnits: { type: UnitType; count: number }[] = [{ type: "INFANTRY", count: infantry }];
    if (tanks > 0) armyUnits.push({ type: "TANK", count: tanks });
    armies.push({
      id: armyId,
      countryId,
      name: "1st Army",
      locationTerritoryId: capitalTerritoryId,
      strength: forceStrength(armyUnits.map((u) => ({ ...u, health: 100 }))),
    });
    for (const u of armyUnits) units.push({ armyId, type: u.type, count: u.count });
  }

  // Rivalries (both directions) for pairs present in this game.
  for (const [a, b] of RIVALRIES) {
    const aId = idByIso.get(a);
    const bId = idByIso.get(b);
    if (!aId || !bId) continue;
    relations.push({ fromId: aId, toId: bId, opinion: -50 }, { fromId: bId, toId: aId, opinion: -50 });
  }

  // Write everything in dependency order.
  await prisma.game.create({
    data: { id: gameId, playerCountry: playerIso, playerName, playerEmail, lastTickAt: new Date() },
  });
  await prisma.country.createMany({ data: countries });
  await prisma.territory.createMany({ data: territories });
  await prisma.building.createMany({ data: buildings });
  await prisma.army.createMany({ data: armies });
  await prisma.unit.createMany({ data: units });
  if (relations.length) await prisma.diplomaticRelation.createMany({ data: relations });

  return gameId;
}

interface Sector {
  name: string;
  kind: TerritoryKind;
  lng: number;
  lat: number;
  population: number;
}

function sectorsFor(seed: CountrySeed): Sector[] {
  const known = KNOWN_SECTORS[seed.iso3];
  if (known) {
    const each = seed.population / known.length;
    return known.map((s) => ({ name: s.name, kind: s.kind as TerritoryKind, lng: s.lng, lat: s.lat, population: each }));
  }
  // Procedural sectors fanned around the capital.
  const n = seed.population > 100 ? 5 : seed.population > 20 ? 4 : 3;
  const each = seed.population / n;
  const out: Sector[] = [
    { name: `${seed.name} Capital`, kind: "CAPITAL", lng: seed.capital[0], lat: seed.capital[1], population: each },
  ];
  const kinds: TerritoryKind[] = ["MAJOR_CITY", "INDUSTRIAL", "PORT", "RURAL"];
  for (let i = 1; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    out.push({
      name: `${seed.name} Region ${i}`,
      kind: kinds[(i - 1) % kinds.length],
      lng: seed.capital[0] + Math.cos(ang) * 2.5,
      lat: seed.capital[1] + Math.sin(ang) * 2.0,
      population: each,
    });
  }
  return out;
}

function startingBuildings(kind: TerritoryKind): { type: Prisma.BuildingCreateManyInput["type"]; level: number }[] {
  const base = [
    { type: "HOUSING" as const, level: 2 },
    { type: "FARM" as const, level: 1 },
  ];
  switch (kind) {
    case "CAPITAL":
      return [...base, { type: "FACTORY", level: 2 }, { type: "POWER_PLANT", level: 2 }, { type: "BARRACKS", level: 1 }];
    case "INDUSTRIAL":
      return [...base, { type: "FACTORY", level: 3 }, { type: "POWER_PLANT", level: 1 }];
    case "PORT":
      return [...base, { type: "PORT", level: 2 }, { type: "NAVAL_BASE", level: 1 }];
    case "MILITARY":
      return [...base, { type: "AIR_BASE", level: 1 }, { type: "BARRACKS", level: 2 }];
    default:
      return base;
  }
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
