import { prisma } from "@/lib/db";
import { COUNTRIES, KNOWN_SECTORS, type CountrySeed } from "@/data/countries";
import type { Prisma, TerritoryKind } from "@prisma/client";

/**
 * Build a fresh world (one save). Creates the player's country plus every AI
 * nation with territories and starting buildings. Returns the new game id.
 */
export async function createGameWorld(
  playerIso: string,
  playerName = "Commander",
  playerEmail?: string
): Promise<string> {
  const game = await prisma.game.create({
    data: { playerCountry: playerIso, playerName, playerEmail, lastTickAt: new Date() },
  });

  for (const seed of COUNTRIES) {
    const isPlayer = seed.iso3 === playerIso;
    const superScale = seed.super ? 1.4 : 1;

    await prisma.country.create({
      data: {
        gameId: game.id,
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
        // Starting stockpiles.
        money: seed.gdp * 0.05,
        oil: seed.gdp * 0.01,
        food: seed.population * 0.5,
        electricity: seed.population * 0.4,
        steel: seed.gdp * 0.005,
        rareMaterials: seed.gdp * 0.001,
        manpower: seed.population * 0.3,
        // AI personality.
        aiAggression: seed.aggression ?? 40,
        aiEconomyFocus: 50,
        aiMilitaryFocus: seed.super ? 60 : 40,
        aiDiplomacyPref: seed.super ? 45 : 60,
        aiRiskTolerance: seed.super ? 55 : 40,
        territories: { create: makeTerritories(seed) },
      },
    });
  }

  return game.id;
}

function makeTerritories(seed: CountrySeed): Prisma.TerritoryCreateWithoutCountryInput[] {
  const sectors = KNOWN_SECTORS[seed.iso3];
  const list: Prisma.TerritoryCreateWithoutCountryInput[] = [];

  if (sectors) {
    const each = seed.population / sectors.length;
    for (const s of sectors) {
      list.push(territory(s.name, s.kind as TerritoryKind, s.lng, s.lat, each, seed.iso3, s.kind === "CAPITAL"));
    }
  } else {
    // Procedural sectors fanned around the capital.
    const n = seed.population > 100 ? 5 : seed.population > 20 ? 4 : 3;
    const each = seed.population / n;
    list.push(territory(`${seed.name} Capital`, "CAPITAL", seed.capital[0], seed.capital[1], each, seed.iso3, true));
    const kinds: TerritoryKind[] = ["MAJOR_CITY", "INDUSTRIAL", "PORT", "RURAL"];
    for (let i = 1; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      list.push(
        territory(
          `${seed.name} Region ${i}`,
          kinds[(i - 1) % kinds.length],
          seed.capital[0] + Math.cos(ang) * 2.5,
          seed.capital[1] + Math.sin(ang) * 2.0,
          each,
          seed.iso3,
          false
        )
      );
    }
  }
  return list;
}

function territory(
  name: string,
  kind: TerritoryKind,
  lng: number,
  lat: number,
  population: number,
  owner: string,
  isCapital: boolean
): Prisma.TerritoryCreateWithoutCountryInput {
  return {
    name,
    kind,
    lng,
    lat,
    population,
    originalOwner: owner,
    defenses: isCapital ? 30 : 10,
    economy: 50,
    morale: 60,
    infrastructure: 50,
    buildings: {
      create: startingBuildings(kind),
    },
  };
}

function startingBuildings(kind: TerritoryKind): Prisma.BuildingCreateWithoutTerritoryInput[] {
  const base: Prisma.BuildingCreateWithoutTerritoryInput[] = [
    { type: "HOUSING", level: 2 },
    { type: "FARM", level: 1 },
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
