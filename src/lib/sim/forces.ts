import { prisma } from "@/lib/db";
import { UNIT_STATS, forceStrength } from "@/lib/units";
import { haversineKm } from "@/lib/geo";
import { MOVEMENT } from "@/lib/balance";
import type { UnitType } from "@prisma/client";

/** Find (or create) the country's primary army, stationed at its capital. */
export async function getHomeArmy(countryId: string) {
  const existing = await prisma.army.findFirst({
    where: { countryId },
    include: { units: true },
    orderBy: { strength: "desc" },
  });
  if (existing) return existing;

  const capital =
    (await prisma.territory.findFirst({ where: { countryId, kind: "CAPITAL" } })) ??
    (await prisma.territory.findFirst({ where: { countryId } }));

  return prisma.army.create({
    data: { countryId, name: "1st Army", locationTerritoryId: capital?.id ?? null },
    include: { units: true },
  });
}

/** Recruit `count` units of `type` into the home army if affordable. */
export async function recruit(countryId: string, type: UnitType, count: number): Promise<boolean> {
  const stat = UNIT_STATS[type];
  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country) return false;

  const money = stat.moneyCost * count;
  const manpower = stat.manpowerCost * count;
  if (country.money < money || country.manpower < manpower) return false;

  const army = await getHomeArmy(countryId);
  const existingUnit = army.units.find((u) => u.type === type);
  if (existingUnit) {
    await prisma.unit.update({ where: { id: existingUnit.id }, data: { count: existingUnit.count + count } });
  } else {
    await prisma.unit.create({ data: { armyId: army.id, type, count } });
  }

  await prisma.country.update({
    where: { id: countryId },
    data: { money: country.money - money, manpower: country.manpower - manpower },
  });

  const units = await prisma.unit.findMany({ where: { armyId: army.id } });
  await prisma.army.update({ where: { id: army.id }, data: { strength: forceStrength(units) } });
  return true;
}

/** Order an army to move toward a target territory; sets arrival time by distance. */
export async function orderMove(armyId: string, targetTerritoryId: string): Promise<boolean> {
  const army = await prisma.army.findUnique({ where: { id: armyId } });
  if (!army) return false;
  const [from, to] = await Promise.all([
    army.locationTerritoryId
      ? prisma.territory.findUnique({ where: { id: army.locationTerritoryId } })
      : null,
    prisma.territory.findUnique({ where: { id: targetTerritoryId } }),
  ]);
  if (!to) return false;

  const km = from ? haversineKm(from.lng, from.lat, to.lng, to.lat) : 200;
  // ~40 km/h strategic land speed, clamped to design bounds.
  const ms = Math.min(MOVEMENT.armorMaxMs, Math.max(MOVEMENT.infantryMinMs, (km / 40) * 3_600_000));

  await prisma.army.update({
    where: { id: armyId },
    data: { state: "MOVING", targetTerritoryId, arrivesAt: new Date(Date.now() + ms) },
  });
  return true;
}
