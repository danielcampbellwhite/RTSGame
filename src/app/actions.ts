"use server";

import { prisma } from "@/lib/db";
import { catchUp } from "@/lib/sim/engine";
import { createGameWorld } from "@/lib/world";
import { getWorldSnapshot, type WorldSnapshot } from "@/lib/snapshot";
import { DIPLOMACY, STRIKE } from "@/lib/balance";
import { buildingCost, buildingDurationMs } from "@/lib/buildings";
import { UNIT_STATS, maxRange, forceStrength } from "@/lib/units";
import { recruit, orderMove, recruitAt, recruitNaval, sailFleet, amphibiousAssault } from "@/lib/sim/forces";
import { startResearchProject } from "@/lib/sim/research";
import { declareWar as declareWarCore, endWar, adjustOpinion, setFlags } from "@/lib/sim/diplomacy";
import type { BuildingType, UnitType, TradeGood } from "@prisma/client";
import { revalidatePath } from "next/cache";

/** Resolve the player country for a game (catch-up should already have run). */
async function player(gameId: string) {
  return prisma.country.findFirst({ where: { gameId, isPlayer: true } });
}
async function countryByIso(gameId: string, iso3: string) {
  return prisma.country.findUnique({ where: { gameId_iso3: { gameId, iso3 } } });
}

/** Create a new save controlled by the given country and return its snapshot. */
export async function createGame(playerIso: string, playerName = "Commander") {
  const gameId = await createGameWorld(playerIso, playerName);
  return gameId;
}

export async function fetchSnapshot(gameId: string): Promise<WorldSnapshot | null> {
  return getWorldSnapshot(gameId);
}

interface BudgetInput {
  taxRate: number;
  militaryBudgetPct: number;
  welfareBudgetPct: number;
  infraBudgetPct: number;
  researchBudgetPct: number;
}

/** Update the player country's policy levers. */
export async function setBudget(gameId: string, levers: BudgetInput) {
  await catchUp(gameId);
  const player = await prisma.country.findFirst({ where: { gameId, isPlayer: true } });
  if (!player) return null;
  await prisma.country.update({
    where: { id: player.id },
    data: {
      taxRate: clampPct(levers.taxRate),
      militaryBudgetPct: clampPct(levers.militaryBudgetPct),
      welfareBudgetPct: clampPct(levers.welfareBudgetPct),
      infraBudgetPct: clampPct(levers.infraBudgetPct),
      researchBudgetPct: clampPct(levers.researchBudgetPct),
    },
  });
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

/** Queue construction/upgrade of a building in a player-controlled territory. */
export async function queueBuilding(gameId: string, territoryId: string, type: BuildingType) {
  await catchUp(gameId);
  const territory = await prisma.territory.findUnique({
    where: { id: territoryId },
    include: { country: true, buildings: true },
  });
  if (!territory || !territory.country.isPlayer || territory.country.gameId !== gameId) return null;

  const existing = territory.buildings.find((b) => b.type === type);
  // Block stacking another upgrade while one is already in progress.
  if (existing?.completesAt) return getWorldSnapshot(gameId);

  const targetLevel = (existing?.level ?? 0) + 1;
  const cost = buildingCost(type, targetLevel);
  const c = territory.country;
  if (c.money < cost.money || c.steel < cost.steel) {
    await prisma.gameEvent.create({
      data: {
        gameId,
        scope: "COUNTRY",
        category: "CONSTRUCTION",
        title: `Cannot afford ${type} in ${territory.name}`,
        body: `Needs ${cost.money.toFixed(0)}₵ and ${cost.steel.toFixed(0)} steel.`,
        countryIso: c.iso3,
        severity: 2,
      },
    });
    return getWorldSnapshot(gameId);
  }

  await prisma.country.update({
    where: { id: c.id },
    data: { money: { decrement: cost.money }, steel: { decrement: cost.steel } },
  });

  const completesAt = new Date(Date.now() + buildingDurationMs(type));
  if (existing) {
    await prisma.building.update({
      where: { id: existing.id },
      data: { buildingToLevel: existing.level + 1, completesAt },
    });
  } else {
    await prisma.building.create({
      data: { territoryId, type, level: 0, buildingToLevel: 1, completesAt },
    });
  }
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

// ── TIME CONTROL ─────────────────────────────────────────────────────────────
export async function setPaused(gameId: string, paused: boolean) {
  if (paused) {
    await catchUp(gameId); // settle the world, then freeze it
    await prisma.game.update({ where: { id: gameId }, data: { paused: true } });
  } else {
    // Resume from "now" so the paused interval isn't simulated.
    await prisma.game.update({ where: { id: gameId }, data: { paused: false, lastTickAt: new Date() } });
  }
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function setSpeed(gameId: string, speed: number) {
  await catchUp(gameId);
  await prisma.game.update({ where: { id: gameId }, data: { speed: Math.max(0.5, Math.min(10, speed)) } });
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

// ── MILITARY ───────────────────────────────────────────────────────────────
export async function recruitUnit(gameId: string, type: UnitType, count: number) {
  await catchUp(gameId);
  const p = await player(gameId);
  if (p) await recruit(p.id, type, count);
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

/** Recruit a unit into a zone's garrison. Requires the zone to be ours and have a barracks. */
export async function recruitAtZone(gameId: string, territoryId: string, type: UnitType, count: number) {
  await catchUp(gameId);
  const p = await player(gameId);
  if (!p) return getWorldSnapshot(gameId);
  const terr = await prisma.territory.findUnique({ where: { id: territoryId }, include: { buildings: true } });
  if (!terr || terr.countryId !== p.id) return getWorldSnapshot(gameId);

  const hasBarracks = terr.buildings.some((b) => b.type === "BARRACKS" && b.level >= 1);
  if (!hasBarracks) {
    await prisma.gameEvent.create({
      data: { gameId, scope: "COUNTRY", category: "SYSTEM", title: `${terr.name} needs a Barracks to recruit`, countryIso: p.iso3, severity: 2 },
    });
    return getWorldSnapshot(gameId);
  }
  await recruitAt(p.id, territoryId, type, count);
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

/** Ranged/air strike: damage a target zone's morale from afar if within range and off cooldown. */
export async function strikeZone(gameId: string, armyId: string, targetZoneId: string) {
  await catchUp(gameId);
  const p = await player(gameId);
  if (!p) return getWorldSnapshot(gameId);
  const army = await prisma.army.findFirst({ where: { id: armyId, countryId: p.id }, include: { units: true } });
  if (!army || !army.locationTerritoryId) return getWorldSnapshot(gameId);
  if (army.strikeReadyAt && army.strikeReadyAt.getTime() > Date.now()) return getWorldSnapshot(gameId);

  const [loc, target] = await Promise.all([
    prisma.territory.findUnique({ where: { id: army.locationTerritoryId } }),
    prisma.territory.findUnique({ where: { id: targetZoneId } }),
  ]);
  if (!loc || !target || target.countryId === p.id) return getWorldSnapshot(gameId);

  const range = maxRange(army.units);
  const dist = Math.hypot(target.lng - loc.lng, target.lat - loc.lat);
  if (dist > range) {
    await prisma.gameEvent.create({
      data: { gameId, scope: "COUNTRY", category: "SYSTEM", title: `${target.name} is out of strike range`, countryIso: p.iso3, severity: 1 },
    });
    return getWorldSnapshot(gameId);
  }

  const dmg = forceStrength(army.units) * STRIKE.moraleFactor;
  await prisma.territory.update({ where: { id: target.id }, data: { morale: Math.max(0, target.morale - dmg) } });
  await prisma.army.update({ where: { id: army.id }, data: { strikeReadyAt: new Date(Date.now() + STRIKE.cooldownMs) } });
  const air = army.units.some((u) => UNIT_STATS[u.type].air);
  await prisma.gameEvent.create({
    data: {
      gameId,
      scope: "REGIONAL",
      category: "BATTLE",
      title: `${air ? "Air strike" : "Bombardment"} on ${target.name}`,
      body: `Morale −${dmg.toFixed(0)}.`,
      countryIso: p.iso3,
      severity: 2,
    },
  });
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

// ── NAVAL ────────────────────────────────────────────────────────────────────
export async function recruitNavalAtZone(gameId: string, zoneId: string, type: UnitType, count: number) {
  await catchUp(gameId);
  const p = await player(gameId);
  if (!p) return getWorldSnapshot(gameId);
  const terr = await prisma.territory.findUnique({ where: { id: zoneId }, include: { buildings: true } });
  if (!terr || terr.countryId !== p.id) return getWorldSnapshot(gameId);
  const port = terr.buildings.some((b) => (b.type === "NAVAL_BASE" || b.type === "PORT") && b.level >= 1);
  if (!port) {
    const building = terr.buildings.some((b) => (b.type === "NAVAL_BASE" || b.type === "PORT") && b.completesAt);
    await prisma.gameEvent.create({
      data: {
        gameId,
        scope: "COUNTRY",
        category: "SYSTEM",
        title: building
          ? `${terr.name}'s shipyard is still under construction`
          : `${terr.name} needs a Naval Base or Port to build ships`,
        body: building ? "Wait for the Naval Base to finish, then build ships." : undefined,
        countryIso: p.iso3,
        severity: 2,
      },
    });
    return getWorldSnapshot(gameId);
  }
  const ok = await recruitNaval(p.id, zoneId, type, count);
  const label = type.charAt(0) + type.slice(1).toLowerCase();
  await prisma.gameEvent.create({
    data: ok
      ? { gameId, scope: "COUNTRY", category: "CONSTRUCTION", title: `${label} commissioned at ${terr.name}`, body: "Joins your national fleet — see the Military tab or the ship icon on the map.", countryIso: p.iso3, severity: 1 }
      : { gameId, scope: "COUNTRY", category: "SYSTEM", title: `Could not build a ${type.toLowerCase()} at ${terr.name}`, body: "Not enough treasury or manpower.", countryIso: p.iso3, severity: 2 },
  });
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function sailFleetToZone(gameId: string, fleetId: string, zoneId: string) {
  await catchUp(gameId);
  const p = await player(gameId);
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  const zone = await prisma.territory.findUnique({ where: { id: zoneId } });
  if (p && fleet && fleet.countryId === p.id && zone) await sailFleet(fleetId, zone.lng, zone.lat);
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function fleetStrike(gameId: string, fleetId: string, zoneId: string) {
  await catchUp(gameId);
  const p = await player(gameId);
  if (!p) return getWorldSnapshot(gameId);
  const fleet = await prisma.fleet.findFirst({ where: { id: fleetId, countryId: p.id }, include: { units: true } });
  if (!fleet) return getWorldSnapshot(gameId);
  if (fleet.strikeReadyAt && fleet.strikeReadyAt.getTime() > Date.now()) return getWorldSnapshot(gameId);
  const target = await prisma.territory.findUnique({ where: { id: zoneId } });
  if (!target || target.countryId === p.id) return getWorldSnapshot(gameId);
  const range = maxRange(fleet.units);
  if (Math.hypot(target.lng - fleet.lng, target.lat - fleet.lat) > range) {
    await prisma.gameEvent.create({ data: { gameId, scope: "COUNTRY", category: "SYSTEM", title: `${target.name} is out of naval range`, countryIso: p.iso3, severity: 1 } });
    return getWorldSnapshot(gameId);
  }
  const dmg = forceStrength(fleet.units) * STRIKE.moraleFactor;
  await prisma.territory.update({ where: { id: target.id }, data: { morale: Math.max(0, target.morale - dmg) } });
  await prisma.fleet.update({ where: { id: fleet.id }, data: { strikeReadyAt: new Date(Date.now() + STRIKE.cooldownMs) } });
  await prisma.gameEvent.create({ data: { gameId, scope: "REGIONAL", category: "BATTLE", title: `Naval bombardment on ${target.name}`, body: `Morale −${dmg.toFixed(0)}.`, countryIso: p.iso3, severity: 2 } });
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function moveArmy(gameId: string, armyId: string, territoryId: string) {
  await catchUp(gameId);
  const p = await player(gameId);
  const army = await prisma.army.findUnique({ where: { id: armyId } });
  if (p && army && army.countryId === p.id) {
    const ok = await orderMove(armyId, territoryId);
    if (!ok) {
      const t = await prisma.territory.findUnique({ where: { id: territoryId } });
      await prisma.gameEvent.create({
        data: { gameId, scope: "COUNTRY", category: "SYSTEM", title: `${t?.name ?? "Target"} can't be reached by land — use an amphibious assault`, countryIso: p.iso3, severity: 2 },
      });
    }
  }
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

/** Send an army across water to a target zone, escorted by a nearby fleet. */
export async function amphibiousAssaultAction(gameId: string, armyId: string, territoryId: string) {
  await catchUp(gameId);
  const p = await player(gameId);
  if (!p) return getWorldSnapshot(gameId);
  const res = await amphibiousAssault(p.id, armyId, territoryId);
  if (res !== "ok") {
    const t = await prisma.territory.findUnique({ where: { id: territoryId } });
    await prisma.gameEvent.create({
      data: {
        gameId,
        scope: "COUNTRY",
        category: "SYSTEM",
        title: res === "no-fleet" ? `Bring a fleet near your army to assault ${t?.name ?? "the target"}` : `Amphibious assault failed`,
        countryIso: p.iso3,
        severity: 2,
      },
    });
  }
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

// ── DIPLOMACY ────────────────────────────────────────────────────────────────
export async function declareWar(gameId: string, targetIso: string) {
  await catchUp(gameId);
  const [p, target] = await Promise.all([player(gameId), countryByIso(gameId, targetIso)]);
  if (p && target) await declareWarCore(gameId, p.id, target.id);
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function proposePeace(gameId: string, warId: string) {
  await catchUp(gameId);
  await endWar(warId);
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function improveRelations(gameId: string, targetIso: string) {
  await catchUp(gameId);
  const [p, target] = await Promise.all([player(gameId), countryByIso(gameId, targetIso)]);
  if (p && target && p.influence >= DIPLOMACY.influenceCostImprove) {
    await prisma.country.update({ where: { id: p.id }, data: { influence: p.influence - DIPLOMACY.influenceCostImprove } });
    await adjustOpinion(p.id, target.id, DIPLOMACY.improveStep);
  }
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function toggleEmbargo(gameId: string, targetIso: string, embargo: boolean) {
  await catchUp(gameId);
  const [p, target] = await Promise.all([player(gameId), countryByIso(gameId, targetIso)]);
  if (p && target) await setFlags(p.id, target.id, { embargo });
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

// ── TRADE ──────────────────────────────────────────────────────────────────
export async function createTradeRoute(
  gameId: string,
  otherIso: string,
  good: TradeGood,
  ratePerDay: number,
  direction: "IMPORT" | "EXPORT"
) {
  await catchUp(gameId);
  const [p, other] = await Promise.all([player(gameId), countryByIso(gameId, otherIso)]);
  if (p && other) {
    const fromId = direction === "EXPORT" ? p.id : other.id;
    const toId = direction === "EXPORT" ? other.id : p.id;
    await prisma.tradeRoute.create({ data: { fromId, toId, good, ratePerDay: Math.max(0, ratePerDay) } });
  }
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

export async function cancelTradeRoute(gameId: string, routeId: string) {
  await catchUp(gameId);
  await prisma.tradeRoute.deleteMany({ where: { id: routeId } });
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

// ── RESEARCH ─────────────────────────────────────────────────────────────────
export async function startResearch(gameId: string, techKey: string) {
  await catchUp(gameId);
  const p = await player(gameId);
  if (p) await startResearchProject(p.id, techKey);
  revalidatePath("/");
  return getWorldSnapshot(gameId);
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}
