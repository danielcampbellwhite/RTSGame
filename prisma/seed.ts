import { prisma } from "../src/lib/db";
import { createGameWorld } from "../src/lib/world";

// Creates a demo save controlled by the United Kingdom so the app has data to
// render immediately after `npm run db:seed`.
async function main() {
  const existing = await prisma.game.findFirst({ where: { playerName: "Demo Commander" } });
  if (existing) {
    console.log(`Demo game already exists: ${existing.id}`);
    return;
  }
  const gameId = await createGameWorld("GBR", "Demo Commander");
  console.log(`Seeded demo game: ${gameId}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
