"use server";

import { prisma } from "@/lib/db";
import { catchUp } from "@/lib/sim/engine";
import { createGameWorld } from "@/lib/world";
import { getWorldSnapshot, type WorldSnapshot } from "@/lib/snapshot";
import { CONSTRUCTION } from "@/lib/balance";
import type { BuildingType } from "@prisma/client";
import { revalidatePath } from "next/cache";

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

  const duration = buildDuration(type);
  const existing = territory.buildings.find((b) => b.type === type);
  const completesAt = new Date(Date.now() + duration);

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

function buildDuration(type: BuildingType): number {
  const fast: BuildingType[] = ["HOUSING", "FARM", "ROAD"];
  const slow: BuildingType[] = ["MISSILE_SILO", "NAVAL_BASE", "AIRPORT", "AIR_BASE"];
  if (fast.includes(type)) return CONSTRUCTION.fastMs;
  if (slow.includes(type)) return CONSTRUCTION.slowMs;
  return CONSTRUCTION.medMs;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}
