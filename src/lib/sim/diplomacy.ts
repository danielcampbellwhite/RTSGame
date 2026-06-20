import { prisma } from "@/lib/db";
import { DIPLOMACY } from "@/lib/balance";

/** Ensure a directed relation row exists; returns it. */
export async function ensureRelation(fromId: string, toId: string) {
  return prisma.diplomaticRelation.upsert({
    where: { fromId_toId: { fromId, toId } },
    create: { fromId, toId },
    update: {},
  });
}

/** Shift opinion in both directions by `delta` (clamped to ±100). */
export async function adjustOpinion(aId: string, bId: string, delta: number) {
  for (const [from, to] of [
    [aId, bId],
    [bId, aId],
  ]) {
    const rel = await ensureRelation(from, to);
    await prisma.diplomaticRelation.update({
      where: { id: rel.id },
      data: { opinion: clamp(rel.opinion + delta, -100, 100) },
    });
  }
}

export async function setFlags(
  aId: string,
  bId: string,
  flags: Partial<{ allied: boolean; embargo: boolean; sanctioned: boolean; guaranteed: boolean; atWar: boolean }>
) {
  for (const [from, to] of [
    [aId, bId],
    [bId, aId],
  ]) {
    const rel = await ensureRelation(from, to);
    await prisma.diplomaticRelation.update({ where: { id: rel.id }, data: flags });
  }
}

/** Aggressor declares war on target. Creates the war + participants. */
export async function declareWar(gameId: string, aggressorId: string, targetId: string) {
  const [agg, tgt] = await Promise.all([
    prisma.country.findUnique({ where: { id: aggressorId } }),
    prisma.country.findUnique({ where: { id: targetId } }),
  ]);
  if (!agg || !tgt) return;

  const existing = await prisma.war.findFirst({
    where: {
      gameId,
      status: "ACTIVE",
      participants: { some: { countryId: aggressorId } },
      AND: { participants: { some: { countryId: targetId } } },
    },
  });
  if (existing) return;

  await prisma.war.create({
    data: {
      gameId,
      name: `${agg.name}–${tgt.name} War`,
      participants: {
        create: [
          { countryId: aggressorId, attacker: true },
          { countryId: targetId, attacker: false },
        ],
      },
    },
  });
  await setFlags(aggressorId, targetId, { atWar: true });
  await adjustOpinion(aggressorId, targetId, -DIPLOMACY.declareWarOpinionHit);

  await prisma.gameEvent.create({
    data: {
      gameId,
      scope: "GLOBAL",
      category: "DIPLOMACY",
      title: `${agg.name} declares war on ${tgt.name}`,
      severity: 3,
      countryIso: agg.iso3,
    },
  });
}

/** End a war and clear atWar between every pair of participants. */
export async function endWar(warId: string) {
  const war = await prisma.war.findUnique({ where: { id: warId }, include: { participants: true } });
  if (!war) return;
  await prisma.war.update({ where: { id: warId }, data: { status: "ENDED", endedAt: new Date() } });
  const ids = war.participants.map((p) => p.countryId);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) await setFlags(ids[i], ids[j], { atWar: false });
  await prisma.gameEvent.create({
    data: { gameId: war.gameId, scope: "GLOBAL", category: "DIPLOMACY", title: `${war.name} ends`, severity: 2 },
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
