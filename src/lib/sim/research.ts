import { prisma } from "@/lib/db";
import { TECH_BY_KEY } from "@/data/tech";

export type ResearchStart = "ok" | "exists" | "prereq" | "fail";

/** Begin a research project if prerequisites are met and it isn't already taken.
 *  `simNow` is the simulation clock so the completion deadline respects pause
 *  and game speed. */
export async function startResearchProject(countryId: string, techKey: string, simNow: Date): Promise<ResearchStart> {
  const node = TECH_BY_KEY[techKey];
  if (!node) return "fail";

  const existing = await prisma.researchProject.findUnique({
    where: { countryId_techKey: { countryId, techKey } },
  });
  if (existing) return "exists";

  // Prerequisites must be completed.
  if (node.requires?.length) {
    const done = await prisma.researchProject.findMany({
      where: { countryId, techKey: { in: node.requires }, completed: true },
    });
    if (done.length < node.requires.length) return "prereq";
  }

  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country) return "fail";

  // Higher research budget => faster completion.
  const budgetFactor = 50 / Math.max(5, country.researchBudgetPct);
  const ms = node.days * 86_400_000 * budgetFactor;

  await prisma.researchProject.create({
    data: {
      countryId,
      techKey,
      category: node.category,
      completesAt: new Date(simNow.getTime() + ms),
    },
  });
  return "ok";
}
