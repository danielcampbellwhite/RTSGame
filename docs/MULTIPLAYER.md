# Aftermath — Multiplayer Considerations

Aftermath is currently single-player. This note sketches how the existing
architecture would extend to multiplayer, and what to watch for. Nothing here
is implemented yet — it's a design reference for a future phase.

## What already helps

- **Deterministic, seed-based world.** `tileAt(seed, x, y)` is a pure function,
  so any number of clients can render the *same* wasteland from a shared seed
  with zero map syncing. This is the single biggest enabler for co-op.
- **Server-authoritative state.** All mutations go through server actions that
  read/write Postgres; the client only renders snapshots. There is no trusted
  client logic to exploit, which is the right foundation for multiplayer.
- **Per-entity rows.** Players, shelters, items, and expeditions are already
  separate rows keyed by `playerId`, so multiple players coexist in the schema
  without restructuring.

## Modes worth considering

1. **Co-op shelter (shared base, separate expeditions).** Several players own
   one shelter; each runs their own expedition on a shared world seed and
   deposits into a common stockpile. Lowest-latency, least-conflict option —
   no two players occupy the same tile at once.
2. **Shared-world raids (players visible to each other).** Players roam the
   same seed simultaneously and can see/help/fight one another. Highest social
   payoff, hardest technically (real-time presence).
3. **Asynchronous PvP traces.** Dead players' caches, faction bounties, or
   "ghosts" of other survivors' routes seed into your single-player world.
   Cheapest multiplayer *feel* with no real-time infrastructure.

## What needs to change

- **Shared shelter model.** Introduce a `Settlement` that owns resources/
  storage/stations, with `Player` as members. Resource deposits and crafting
  become settlement-scoped. Add optimistic-concurrency (version column) or
  row-level transactions to avoid double-spend on shared stockpiles.
- **Real-time transport.** Snapshots are currently request/response. Shared
  presence needs push — websockets / SSE / a service like Pusher, or Postgres
  `LISTEN/NOTIFY` fanned out through an edge function. Expedition state would
  broadcast position/encounter deltas.
- **Authoritative tick.** Encounters resolve inside server actions today. For
  shared-world combat, move resolution to a single authority (a per-world
  worker) so two players can't both "first-strike" the same enemy.
- **Conflict & griefing rules.** Faction standing, friendly-fire toggles, and
  instancing of loot (per-player loot rolls on a shared tile) prevent one
  player from stripping a co-op partner's run.
- **Identity & sessions.** Move off the localStorage `playerId` to real
  accounts (auth) before exposing shared/persistent worlds.

## Recommended first step

Co-op shelter (mode 1) on a shared seed: it reuses the deterministic world and
server-authoritative actions almost verbatim, needs only the `Settlement`
aggregate + auth, and avoids real-time presence entirely. Shared-world raids
(mode 2) can layer on later once a push transport exists.
