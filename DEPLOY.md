# Deploying World Dominion (Vercel + Neon)

The repo is **push-to-deploy**: Vercel builds it, and the build step
(`vercel-build`) automatically applies the database schema to Neon via
`prisma migrate deploy`. You don't run any database command by hand. The game
creates its world at runtime the first time a player picks a country, so there's
no seed step either.

## Prerequisites
- This repo on GitHub (done).
- A Neon Postgres project (done).
- A Vercel account (free Hobby tier is fine to start).

## 1. (Security) Rotate your Neon password
The password was shared in chat, so rotate it: **Neon console → your project →
Roles → reset password.** Use the new password in the connection strings below.

## 2. Get the two connection strings
In the Neon dashboard, copy:
- **Pooled** connection (host contains `-pooler`) → this becomes `DATABASE_URL`.
- **Direct** connection (no `-pooler`) → this becomes `DIRECT_URL` (used by migrations).

Both should end with `?sslmode=require`.

## 3. Import the repo into Vercel
- Vercel → **Add New… → Project** → import this GitHub repo.
- Framework preset: **Next.js** (auto-detected). Leave the build command default —
  Vercel automatically runs the `vercel-build` script.
- Set the **Production Branch** to the branch you want live
  (e.g. `main`, or merge this feature branch into `main` first).

## 4. Set environment variables
In the Vercel project → **Settings → Environment Variables**, add (Production +
Preview):

| Name           | Value                                                        |
|----------------|--------------------------------------------------------------|
| `DATABASE_URL` | Neon **pooled** connection string                            |
| `DIRECT_URL`   | Neon **direct** connection string                            |
| `CRON_SECRET`  | a long random string (protects `/api/tick`)                  |

The app auto-detects the `neon.tech` host and uses Neon's serverless driver, which
is the correct setup for Vercel's serverless functions.

## 5. Deploy
Trigger a deploy (push to the production branch, or click **Deploy**). During the
build, `prisma migrate deploy` connects to Neon over `DIRECT_URL` and creates all
tables from `prisma/migrations/`. When the build finishes, the app is live.

## 6. Background simulation (the cron)
`vercel.json` declares a **daily** cron hitting `/api/tick` — the most the Vercel
**Hobby** plan allows. The world also advances whenever anyone opens the app
(on-read catch-up). For proper offline progression on the free tier, this repo
includes a **GitHub Actions workflow** (`.github/workflows/tick.yml`) that pings
`/api/tick` every ~5 minutes.

Enable it: in the GitHub repo → **Settings → Secrets and variables → Actions**,
add two secrets:
- `TICK_URL` → `https://<your-app>.vercel.app/api/tick`
- `CRON_SECRET` → the same value you set in Vercel

The workflow runs on the default branch (`main`) automatically; you can also run
it manually from the **Actions** tab (workflow_dispatch).

**If you upgrade to Vercel Pro:** change `vercel.json`'s schedule to `* * * * *`
for a native minute cron and you can drop the GitHub Action.

## 7. Play
Open the deployed URL → pick a nation → the world is generated in Neon and you're
in. Your save id is stored in the browser's `localStorage`.

## Notes & gotchas
- **First-world creation** writes ~60 nations in a few batched queries — fast,
  well inside the serverless timeout.
- **Schema changes later:** edit `prisma/schema.prisma`, run
  `npx prisma migrate dev --name <change>` locally (against a dev DB), commit the
  new folder under `prisma/migrations/`, and the next Vercel deploy applies it.
- **Costs:** $0 on Neon free + Vercel Hobby (+ external pinger). ~$20/mo if you
  want Vercel Pro for the native minute cron.
