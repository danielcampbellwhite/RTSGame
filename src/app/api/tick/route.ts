import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { catchUp } from "@/lib/sim/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron target (every minute). Advances every active game so the world
 * keeps simulating while players are offline. Same code path as on-read catch-up.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const games = await prisma.game.findMany({
    where: { paused: false },
    select: { id: true },
  });

  const now = new Date();
  let ok = 0;
  for (const g of games) {
    try {
      await catchUp(g.id, now);
      ok++;
    } catch (err) {
      console.error(`tick failed for game ${g.id}`, err);
    }
  }

  return NextResponse.json({ ticked: ok, total: games.length, at: now.toISOString() });
}
