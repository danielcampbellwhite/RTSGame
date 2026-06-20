# World Dominion

A persistent, real-time, single-player geopolitical **grand strategy game**.
Pick any of ~190 real-world nations; every other nation is AI. The world
simulates continuously — including while you're offline.

> Full game design, systems, balancing and architecture: **[DESIGN.md](./DESIGN.md)**.

## Stack

- **Next.js 16** (App Router, Server Actions) + **React 19** + **TypeScript**
- **Tailwind CSS v4** — neon "command center" theme
- **MapLibre GL** — WebGL world map, neon-on-dark, **no API key required**
- **Zustand** — client state
- **Prisma + PostgreSQL** — persistence
- **Vercel Cron** — 1-minute background simulation tick

## The simulation model

Vercel has no always-on process, so the world advances via a **deterministic
catch-up** anchored on `Game.lastTickAt`:

- **On read** — every page load / server action catches the game up to now.
- **Cron `/api/tick`** (every minute) — advances all active games while you're away.

Both call the same `catchUp()` engine in `src/lib/sim/engine.ts`, so the result
is identical regardless of cadence. All timed actions (construction, movement,
research) store absolute timestamps so offline gaps resolve correctly.

## Getting started

```bash
npm install
cp .env.example .env          # set DATABASE_URL (Vercel Postgres / Neon / Supabase)
npm run db:push               # create tables
npm run db:seed               # create a demo UK-controlled save
npm run dev                   # http://localhost:3000
```

On first load with no save, pick a nation to start a new game (stored in
`localStorage`).

## Project layout

```
prisma/schema.prisma      full DB schema (all 9 phases)
prisma/seed.ts            demo save
src/data/countries.ts     real-world nation dataset
src/lib/balance.ts        all gameplay tunables
src/lib/world.ts          world generation (createGameWorld)
src/lib/sim/engine.ts     deterministic catch-up simulation
src/lib/snapshot.ts       catch-up + render snapshot
src/app/actions.ts        server actions (mutations)
src/app/api/tick/route.ts Vercel Cron endpoint
src/components/           WorldMap / ResourceBar / InfoPanel / EventFeed
```

## Implementation status

| Phase | Scope | Status |
|---|---|---|
| 1 | Map & countries | ✅ done |
| 2 | Economy | ✅ revenue, upkeep, GDP, resources, inflation |
| 3 | Buildings | ✅ construction timers + production |
| 4 | Military & combat | ✅ units, armies, movement, front-line combat, capture |
| 5 | AI | ✅ personality-driven utility AI |
| 6 | Diplomacy | ✅ opinion, war/peace, embargo |
| 7 | Trade | ✅ routes, pricing, resource flows |
| 8 | Research & world events | ✅ tech tree + effects, world events |
| 9 | Polish | ◐ tabbed command UI + map overlays (animations/audio/tutorial pending) |

All phases compile and build clean. See `DESIGN.md` §9 for detail.