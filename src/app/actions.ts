"use server";

import { prisma } from "@/lib/db";
import { catchUp } from "@/lib/sim/engine";
import { createGameWorld } from "@/lib/world";
import { getWorldSnapshot, type WorldSnapshot } from "@/lib/snapshot";
import { DIPLOMACY } from "@/lib/balance";
import { buildingCost, buildingDurationMs } from "@/lib/buildings";
import { recruit, orderMove } from "@/lib/sim/forces";
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

export async function moveArmy(gameId: string, armyId: string, territoryId: string) {
  await catchUp(gameId);
  const p = await player(gameId);
  const army = await prisma.army.findUnique({ where: { id: armyId } });
  if (p && army && army.countryId === p.id) await orderMove(armyId, territoryId);
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
