# World Dominion — Design & Technical Document

> A persistent, real-time, single-player geopolitical grand strategy game.
> Pick any of ~190 real nations; every other nation is AI. The world simulates
> continuously — including while you are offline.

---

## 1. Design pillars

1. **The world never stops.** Time is real wall-clock time. Logging in
   *catches the simulation up* to now; a server cron advances it while you're away.
2. **Economy is power.** You cannot win by spamming armies — units cost upkeep in
   money, manpower, fuel and basing. A broke nation collapses faster than a conquered one.
3. **Territory is granular.** Countries are made of conquerable **sectors**. Wars
   move front lines sector-by-sector over hours/days; you never instantly delete a country.
4. **Consequences compound.** Aggression isolates you diplomatically; high taxes
   crush morale; neglected infrastructure throttles everything. Systems feed each other.
5. **Solo-dev / Vercel-native.** No always-on game server. Stateless Next.js +
   Postgres + a 1-minute Vercel Cron. All simulation is deterministic catch-up.

---

## 2. The core gameplay loop

**Minute-to-minute (active session):**
Read the world → assess threats/opportunities on the map → adjust budget levers
(tax / military / welfare / infra / research) → queue construction & research →
issue military/diplomacy/trade orders → watch the event feed react.

**Session-to-session (persistent):**
Log out. The cron keeps ticking: economies grow, construction finishes, fleets
sail, AI nations scheme, wars grind, world events fire. Log back in hours later
to a changed world and a stack of events to triage.

**Long-arc (months):**
Climb one or more of the open-ended goals — highest GDP, most influence, largest
territory, strongest military, or outright global domination. There is no "win
screen"; the game is a sandbox you keep shaping.

---

## 3. Time & the simulation model (the key architectural decision)

Vercel has no long-running process, so World Dominion uses a **deterministic
catch-up simulation** anchored on `Game.lastTickAt`:

```
elapsed = now - lastTickAt
advance the world by `elapsed`
lastTickAt = now
```

Two triggers run the exact same code path:

- **On read** — any page load or server action first catches the game up, so the
  player always sees a current world.
- **Vercel Cron `/api/tick` (every 1 min)** — advances *all active games* so AI,
  wars and economies progress while nobody is looking.

Because the same `simulate(game, elapsedMs)` function is used by both, the result
is identical regardless of how often it runs (idempotent over wall-clock time).

**Tick cadence (logical, inside one catch-up):**

| System            | Cadence        | Notes                                   |
|-------------------|----------------|-----------------------------------------|
| Global tick       | 1 min          | movement arrivals, order resolution     |
| Economy update    | 5 min          | production, treasury, GDP drift         |
| Morale/stability  | 5 min          | drift toward target from tax/war/food   |
| Construction      | event (timer)  | completes at `Building.completesAt`     |
| Research          | event (timer)  | completes at `ResearchProject.completesAt` |
| Combat resolution | 1 min          | front lines shift gradually             |
| World events      | hourly (prob.) | recession, pandemic, disaster, etc.     |

Catch-up steps in capped chunks (default 1-minute logical steps, max N steps per
invocation) so a player returning after a week doesn't blow the function timeout —
long gaps are integrated in coarser chunks while preserving timer-based completions.

**Travel/build times (design targets):**
Infantry 1–6 h · armor 2–12 h · air missions minutes–hours · ships days–weeks ·
construction hours–days · research days. All stored as absolute `arrivesAt` /
`completesAt` timestamps so they survive offline gaps.

---

## 4. Systems

### 4.1 Economy (Phase 2 — the spine)
- **Resources:** money, oil, food, electricity, steel, rare materials, manpower.
- **Budget levers (sum to spending of tax revenue):** military / welfare / infra / research.
- **Revenue** = f(GDP, taxRate, stability, infrastructure). **Costs** = unit upkeep
  + building upkeep + welfare obligations.
- **Failure modes:** deficit → debt → inflation → recession; food shortage → morale
  collapse → unrest → separatism. Balancing rule: **military upkeep scales
  super-linearly** with force size so "tank spam" bankrupts you.

### 4.2 Morale & stability (Phase 2)
Per-territory `morale` and `unrest`. Drivers: tax rate, war casualties,
unemployment, food, occupation, propaganda. Low morale → protests → reduced income
→ rebellion → separatism (territory flips to rebels/original owner). High morale →
production, recruitment and tax bonuses.

### 4.3 Buildings (Phase 3)
Civilian (housing, factory, power plant, farm, hospital), military (barracks, air
base, naval base, missile silo, radar), infrastructure (road, railway, port,
airport). Levels improve output; construction takes real time and consumes steel +
money. Buildings live on **territories**, so losing a sector loses its production.

### 4.4 Military (Phase 4)
Land (infantry, mech, tank, artillery, AA), air (fighter, bomber, drone,
transport), naval (frigate, destroyer, sub, carrier), special (missile, nuke,
intel). Forces (`Army`/`Fleet`/`AirWing`) are bags of `Unit`s with strength,
morale, supply. Units need maintenance, manpower, fuel and bases — and cannot be
produced infinitely (manpower + basing caps).

### 4.5 Combat (Phase 4)
Resolved over time, not instantly. Front lines advance by shifting `controlPct` on
contested territories each tick. Modifiers: terrain, morale, supply, air
superiority, fortifications, weather. Occupation accrues; cities resist (higher
defense + unrest while occupied).

### 4.6 AI (Phase 5)
Every country carries a personality vector: aggression, economyFocus,
militaryFocus, diplomacyPref, riskTolerance. A lightweight **utility AI** scores
candidate actions (build, research, trade, ally, sanction, mobilize, declare war,
sue for peace) each AI cadence and executes the best affordable one. Goals: survive
→ grow economy → protect borders → gain influence → avoid collapse. Superpowers
(USA/China/Russia/India/UK/France) get larger budgets, influence reach and risk
appetite; small nations weight diplomacy/survival.

### 4.7 Diplomacy (Phase 6)
Pairwise `opinion` (−100..+100) plus flags: allied, embargo, sanctioned,
guaranteed, atWar. Actions shift opinion; aggression cascades into coalitions and
global isolation. AI reacts to player actions through the same opinion model.

### 4.8 Trade (Phase 7)
Directed `TradeRoute`s move a good at a rate/day via shipping/air/land. Blockades
and wars disable routes; markets shift prices with global supply shocks (tie-in to
world events). Trade is the small-nation path to relevance.

### 4.9 Research (Phase 8 tech tree)
Categories: military, economy, energy, intelligence, infrastructure. Real-time
projects (`completesAt`) grant multipliers/unlocks. Research budget % converts
treasury → progress, scaled by tech level and infrastructure.

### 4.10 World events (Phase 8)
Probabilistic hourly rolls: recession, pandemic, refugee crisis, oil shortage,
natural disaster, cyber attack, political instability — scoped GLOBAL/REGIONAL/
COUNTRY, each applying stat deltas and emitting a feed entry.

### 4.11 Victory / goals (open-ended)
No single win condition. Tracked leaderboards: GDP, influence, territory count,
military strength, "domination %". Designed to run indefinitely.

---

## 5. Architecture

```
Next.js 16 (App Router, RSC)
 ├─ Client: React 19 + Zustand store + MapLibre GL (GeoJSON neon layers) + D3 overlays
 ├─ Server Actions: all mutations (issue orders, set budgets, queue builds…)
 │   └─ every action first runs catchUp(game) then applies the mutation
 ├─ /api/tick  (Vercel Cron, */1 * * * *) → catchUp(all active games)
 └─ Prisma → PostgreSQL (Vercel Postgres / Neon / Supabase)

src/lib/sim/  ← deterministic, pure-ish simulation engine (the heart)
```

**Why MapLibre over Mapbox:** identical API, fully open-source, **no API token** —
critical for a zero-config solo Vercel deploy. The "dark satellite / neon" look is
achieved with a dark style + GeoJSON fill/line layers (neon borders), animated
overlays for trade routes, fleets and front lines.

**State split:** server is source of truth (DB). Client mirrors a snapshot into
Zustand for fast UI; mutations go through server actions which re-fetch.

---

## 6. Database

See `prisma/schema.prisma`. Entities: `Game`, `Country`, `Territory`, `Building`,
`Army`/`Fleet`/`AirWing`/`Unit`, `DiplomaticRelation`, `TradeRoute`,
`ResearchProject`, `War`/`WarParticipant`, `GameEvent`. Notes:

- A **Game** is a save; it owns one player country + ~189 AI countries (full
  isolation between saves via `gameId`).
- **Territory** is the conquerable "region"; its `kind` enum encodes
  capital/major-city/industrial/port/military/rural. `controlPct` + `originalOwner`
  model gradual conquest and reconquest. `neighbors[]` drives front-line spread.
- Resource stockpiles live as columns on `Country` (fast reads, no join per tick).
- All time-based actions store absolute timestamps (`arrivesAt`, `completesAt`) so
  offline catch-up resolves them correctly.

---

## 7. API / Server-action surface (representative)

| Action                         | Effect                                            |
|--------------------------------|---------------------------------------------------|
| `createGame(iso3, name)`       | seed a world, assign player country               |
| `getWorldSnapshot(gameId)`     | catch-up + return render snapshot                 |
| `setBudget(countryId, levers)` | update tax & spending split                       |
| `queueBuilding(territoryId, type)` | start construction (sets `completesAt`)       |
| `startResearch(countryId, techKey)` | begin a project                              |
| `moveArmy(armyId, targetTerritoryId)` | set MOVING + `arrivesAt`                   |
| `declareWar / proposePeace / setStance` | diplomacy mutations                     |
| `createTradeRoute / cancelTradeRoute`   | trade mutations                         |

Every mutating action runs `catchUp(game)` first, applies the change, writes, and
returns the fresh snapshot.

---

## 8. UI — the command center

```
┌────────────────────────────────────────────────────────┐
│ TOP: resource bar (money/oil/food/elec/steel/rare/manpwr)│  ← glowing readouts
├──────────────────────────────────────┬───────────────────┤
│ LEFT: WebGL world map                 │ RIGHT: info panel │
│  dark base, neon borders, front lines │  selected country/│
│  animated trade routes, fleets, air   │  territory + tabs │
├──────────────────────────────────────┴───────────────────┤
│ BOTTOM: scrolling event feed (battles, events, diplomacy) │
└────────────────────────────────────────────────────────┘
```

Aesthetic: futuristic dark command center — near-black map, cyan/magenta neon
borders, glowing contested front lines, pulsing fleet/aircraft markers, animated
dashed trade routes.

---

## 9. Development phases & status

| Phase | Scope                       | Status                                  |
|-------|-----------------------------|-----------------------------------------|
| 1     | Map & countries             | ✅ implemented (this session)           |
| 2     | Economy                     | ◐ tick engine + economy/morale wired    |
| 3     | Buildings                   | ◐ schema + construction timers in tick  |
| 4     | Military & combat           | ▢ schema + order/movement hooks         |
| 5     | AI                          | ▢ personality model + utility-AI hook   |
| 6     | Diplomacy                   | ▢ relation model + actions stubbed      |
| 7     | Trade                       | ▢ route model + stubbed flows           |
| 8     | Research & world events     | ▢ schema + event emitter scaffolded     |
| 9     | Polish (animations, audio, balancing, tutorial) | ▢            |

Legend: ✅ done · ◐ foundation working, depth pending · ▢ scaffolded for next phase.

---

## 10. Balancing reference (starting numbers)

- Tax sweet spot ≈ 20–30%; above ~45% morale falls faster than revenue rises.
- Military upkeep grows ~`units^1.15` → discourages spam.
- Food deficit drops territory morale ~2/min; sustained → unrest → secession at unrest ≥ 80.
- Construction: housing/farm hours; factories/military bases ~1 day; silos/carriers multi-day.
- Catch-up cap: 1-minute steps, max ~720 logical steps per invocation (coarsen beyond).

All tunables live in `src/lib/balance.ts` for fast iteration.
