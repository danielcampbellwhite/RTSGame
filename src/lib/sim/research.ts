import { prisma } from "@/lib/db";
import { TECH_BY_KEY } from "@/data/tech";

/** Begin a research project if prerequisites are met and it isn't already taken. */
export async function startResearchProject(countryId: string, techKey: string): Promise<boolean> {
  const node = TECH_BY_KEY[techKey];
  if (!node) return false;

  const existing = await prisma.researchProject.findUnique({
    where: { countryId_techKey: { countryId, techKey } },
  });
  if (existing) return false;

  // Prerequisites must be completed.
  if (node.requires?.length) {
    const done = await prisma.researchProject.findMany({
      where: { countryId, techKey: { in: node.requires }, completed: true },
    });
    if (done.length < node.requires.length) return false;
  }

  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country) return false;

  // Higher research budget => faster completion.
  const budgetFactor = 50 / Math.max(5, country.researchBudgetPct);
  const ms = node.days * 86_400_000 * budgetFactor;

  await prisma.researchProject.create({
    data: {
      countryId,
      techKey,
      category: node.category,
      completesAt: new Date(Date.now() + ms),
    },
  });
  return true;
}
