# World Dominion — Tactical Map RTS Roadmap

The target experience: a **persistent, live, Call-of-War-style WW2 map game**. The
world is one continuous battlefield you watch and command in real time. This file
tracks the vision and the order we build it.

## Target mechanics (from design intent)

1. **Movable physical units.** Recruited units exist as real entities on the map,
   each rendered as an icon of its type. You select and order them to move.
2. **Zoom-aware detail.** Zoomed out → strategic view (country colours, fronts).
   Zoom in → country/zone names, individual unit stacks, terrain.
3. **Zone = the atomic battlefield tile.** Every country is divided into zones
   (sectors / major cities). Zones are captured individually; **a captured zone
   becomes part of the conqueror's country** (ownership transfers — already wired).
   Build industry in a zone for economy, barracks for recruitment, ports for ships.
4. **Land/sea separation.**
   - Land armies **cannot cross water** unaccompanied; they must embark on
     **transport ships or aircraft** as a group to cross seas.
   - **Ships** move freely on water, dock at **ports** (port-zones on the coast),
     and carry/escort land forces.
5. **Vision & fog of war.** Each unit has a **sight range**; you only see enemy
   units within range of your own units/zones. Reconnaissance matters.
6. **Live front lines.** Combat resolves continuously; control of contested zones
   shifts over time and the map visibly redraws as borders move — a "virtual war"
   playing out whether or not you're watching.

## Build order (incremental, each shippable)

| Step | Scope | Status |
|---|---|---|
| 0 | Status colours, selection glow, war/unit icons, zone output stats | ✅ done |
| 1 | **Zoom-based country labels** | ◐ in progress |
| 2 | **Render all zones** (every country's sectors) as the map's tile layer, coloured by owner; click any zone to inspect/target | ▢ |
| 3 | **Free-form army movement** to any adjacent friendly/enemy zone; live front-line capture already transfers ownership | ▢ |
| 4 | **Barracks-gated, per-zone recruitment & garrisons** (units belong to/stack on zones) | ▢ |
| 5 | **Vision / fog of war** — unit sight range; hide enemies out of range | ▢ |
| 6 | **Ports & naval** — coastal port zones, fleets, ship movement, naval combat | ▢ |
| 7 | **Amphibious/air transport** — land units embark to cross water as a group | ▢ |
| 8 | **Zoom-aware unit stacks** — individual unit icons that appear/cluster by zoom | ▢ |

## Key architecture implications

- **Zone adjacency graph.** Free-form movement and front lines need a real
  adjacency model (`Territory.neighbors` exists but isn't populated). We'll
  generate adjacency from zone proximity + a land/sea flag per zone.
- **Land vs sea zones.** Tag each zone (and the gaps between countries) so the
  pathing knows where water is and where ports sit.
- **Snapshot scope.** The client currently only receives the player's zones; the
  tactical map needs all zones (with fog-of-war filtering applied server-side so
  hidden enemies aren't leaked).
- **Movement pathing.** Army orders become multi-zone paths along the adjacency
  graph with per-hop travel time, instead of point-to-point great-circle moves.
- **Performance.** ~200+ zones + unit stacks render fine in MapLibre via GeoJSON
  sources; fog-of-war keeps payloads small.
