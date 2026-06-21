import { prisma } from "@/lib/db";
import { UNIT_STATS, forceStrength } from "@/lib/units";
import { haversineKm } from "@/lib/geo";
import { pathCrossesWater } from "@/lib/landcheck";
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

/** Recruit `count` units of `type` into the army garrisoning a specific zone. */
export async function recruitAt(countryId: string, territoryId: string, type: UnitType, count: number): Promise<boolean> {
  const stat = UNIT_STATS[type];
  const [country, terr] = await Promise.all([
    prisma.country.findUnique({ where: { id: countryId } }),
    prisma.territory.findUnique({ where: { id: territoryId } }),
  ]);
  if (!country || !terr) return false;

  const money = stat.moneyCost * count;
  const manpower = stat.manpowerCost * count;
  if (country.money < money || country.manpower < manpower) return false;

  let army = await prisma.army.findFirst({
    where: { countryId, locationTerritoryId: territoryId },
    include: { units: true },
  });
  if (!army) {
    army = await prisma.army.create({
      data: { countryId, name: `${terr.name} Garrison`, locationTerritoryId: territoryId },
      include: { units: true },
    });
  }

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

/** Recruit a naval unit into the country's fleet (created at the port zone if new). */
export async function recruitNaval(countryId: string, zoneId: string, type: UnitType, count: number): Promise<boolean> {
  const stat = UNIT_STATS[type];
  const [country, terr] = await Promise.all([
    prisma.country.findUnique({ where: { id: countryId } }),
    prisma.territory.findUnique({ where: { id: zoneId } }),
  ]);
  if (!country || !terr) return false;
  const money = stat.moneyCost * count;
  const manpower = stat.manpowerCost * count;
  if (country.money < money || country.manpower < manpower) return false;

  let fleet = await prisma.fleet.findFirst({ where: { countryId }, include: { units: true } });
  if (!fleet) {
    fleet = await prisma.fleet.create({ data: { countryId, name: "Fleet", lng: terr.lng, lat: terr.lat }, include: { units: true } });
  }
  const existing = fleet.units.find((u) => u.type === type);
  if (existing) await prisma.unit.update({ where: { id: existing.id }, data: { count: existing.count + count } });
  else await prisma.unit.create({ data: { fleetId: fleet.id, type, count } });

  await prisma.country.update({ where: { id: countryId }, data: { money: country.money - money, manpower: country.manpower - manpower } });
  const units = await prisma.unit.findMany({ where: { fleetId: fleet.id } });
  await prisma.fleet.update({ where: { id: fleet.id }, data: { strength: forceStrength(units) } });
  return true;
}

/** Sail a fleet toward a coordinate (slow, distance-based). */
export async function sailFleet(fleetId: string, lng: number, lat: number): Promise<boolean> {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return false;
  const km = haversineKm(fleet.lng, fleet.lat, lng, lat);
  // ~35 km/h cruising; ships are slow — days for long crossings.
  const ms = Math.max(2 * 3_600_000, (km / 35) * 3_600_000);
  await prisma.fleet.update({
    where: { id: fleetId },
    data: { state: "MOVING", targetLng: lng, targetLat: lat, arrivesAt: new Date(Date.now() + ms) },
  });
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
  // Land armies can't walk across open sea — they need an amphibious assault.
  if (from && pathCrossesWater(from.lng, from.lat, to.lng, to.lat)) return false;

  const km = from ? haversineKm(from.lng, from.lat, to.lng, to.lat) : 200;
  // ~40 km/h strategic land speed, clamped to design bounds.
  const ms = Math.min(MOVEMENT.armorMaxMs, Math.max(MOVEMENT.infantryMinMs, (km / 40) * 3_600_000));

  await prisma.army.update({
    where: { id: armyId },
    data: { state: "MOVING", targetTerritoryId, arrivesAt: new Date(Date.now() + ms) },
  });
  return true;
}

/** Amphibious assault: army crosses water to a target zone, escorted by a fleet
 *  that must be near the army. Travels at naval speed; engages on arrival. */
export async function amphibiousAssault(
  countryId: string,
  armyId: string,
  targetTerritoryId: string
): Promise<"ok" | "no-fleet" | "fail"> {
  const army = await prisma.army.findUnique({ where: { id: armyId } });
  if (!army || army.countryId !== countryId || !army.locationTerritoryId) return "fail";
  const [from, to] = await Promise.all([
    prisma.territory.findUnique({ where: { id: army.locationTerritoryId } }),
    prisma.territory.findUnique({ where: { id: targetTerritoryId } }),
  ]);
  if (!from || !to) return "fail";

  const fleets = await prisma.fleet.findMany({ where: { countryId } });
  const escort = fleets.find((f) => Math.hypot(f.lng - from.lng, f.lat - from.lat) <= 3);
  if (!escort) return "no-fleet";

  const km = haversineKm(from.lng, from.lat, to.lng, to.lat);
  const ms = Math.max(6 * 3_600_000, (km / 35) * 3_600_000); // naval-speed crossing
  await prisma.army.update({
    where: { id: armyId },
    data: { state: "MOVING", targetTerritoryId, arrivesAt: new Date(Date.now() + ms) },
  });
  await sailFleet(escort.id, to.lng, to.lat);
  return "ok";
}
