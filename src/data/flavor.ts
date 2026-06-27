// Narrative flavor for the wasteland. Pure string banks + tiny helpers so the
// terminal can describe what the survivor sees and does. Picks are driven by a
// passed-in RNG (deterministic per tile when seeded from the tile).

import { pick, type Rng } from "@/lib/rng";
import type { Biome, HazardKind } from "@/data/world";

const AMBIANCE: Record<Biome, string[]> = {
  WASTES: [
    "Cracked earth stretches to a brown, hazy horizon.",
    "Dust devils spin lazily across the flats.",
    "A rusted car husk bakes in the heat, half-swallowed by sand.",
    "Bleached bones of something large jut from the dirt.",
    "The wind carries grit that stings your eyes.",
  ],
  FOREST: [
    "Skeletal trees claw at a colourless sky.",
    "Dead leaves crunch wetly underfoot.",
    "Something rustles in the blackened undergrowth, then stills.",
    "Pale fungus creeps up every trunk.",
    "A snapped branch hangs, dripping sap that smells wrong.",
  ],
  URBAN: [
    "Collapsed storefronts lean over a debris-choked street.",
    "Shattered glass glitters across cracked asphalt.",
    "A dead traffic light sways on its cable above you.",
    "Graffiti screams a warning you can't quite read.",
    "Burned-out cars form a rusted maze between the towers.",
  ],
  INDUSTRIAL: [
    "Silent smokestacks loom against the overcast.",
    "Pools of chemical sludge reflect an oily rainbow.",
    "Conveyor belts rot inside a gutted warehouse.",
    "Pipework groans somewhere in the dark, though nothing runs.",
    "The ground is slick with decades of spilled grease.",
  ],
  IRRADIATED: [
    "Your geiger counter clicks faster the moment you arrive.",
    "The air shimmers a sickly, luminous green.",
    "Glassy craters pock the scorched ground.",
    "Everything here casts a faint, wrong-coloured glow.",
    "A metallic taste coats your tongue almost instantly.",
  ],
};

// Ambient life — fired occasionally with no mechanical effect, to make the
// world feel inhabited.
const AMBIENT: string[] = [
  "Distant gunfire crackles, then fades.",
  "A flock of black birds scatters from a rooftop.",
  "Somewhere far off, a dog barks twice — then silence.",
  "The wind howls through hollow ruins.",
  "You hear an engine, miles away. It doesn't get closer.",
  "A scream echoes from the distance. Not your problem. Yet.",
  "Loose sheet metal bangs in the wind like a slow drum.",
  "Rats pour out of a drain and vanish.",
];

const ENEMY_ENTRANCE: string[] = [
  "A {n} bursts from cover, weapon raised!",
  "You freeze — a {n} has already seen you.",
  "A {n} steps into your path, snarling.",
  "Too late: a {n} is on you.",
  "Movement — a {n} closes in fast.",
];

const HAZARD_RAD: string[] = [
  "The radiation field bites. Your skin prickles.",
  "Alarms in your head: the rads here are brutal.",
  "You push through the glowing haze, regretting it instantly.",
];
const HAZARD_TOX: string[] = [
  "Toxic vapour rolls over you; your lungs burn.",
  "The chemical reek makes your eyes stream.",
  "You wade through a spill that eats at your boots.",
];

const SEARCH_NOTHING: string[] = [
  "You pick through the wreckage but find nothing of use.",
  "Picked clean. Someone got here first.",
  "Just dust, rust, and disappointment.",
];

const SURVIVOR_NAMES = [
  "Mara", "Cole", "Dove", "Rook", "Sasha", "Tobias", "Lena", "Hatch", "Wren", "Diaz",
  "Pike", "Nessa", "Juno", "Gareth", "Sable", "Otis", "Vera", "Bishop", "Echo", "Marlow",
];
const SURVIVOR_INTRO = [
  "{n}, a wary survivor, raises empty hands — \"I'm not looking for trouble.\"",
  "A gaunt figure named {n} steps out, eyeing your gear. \"You got a safe place?\"",
  "{n} lowers a rusted pistol when they see you're human. \"Thank god. You alone?\"",
  "Huddled by a fire, {n} looks up. \"Room for one more wherever you're headed?\"",
];

export function survivorName(rng: Rng): string {
  return pick(rng, SURVIVOR_NAMES);
}
export function survivorIntro(rng: Rng, name: string): string {
  return pick(rng, SURVIVOR_INTRO).replace("{n}", name);
}

export function sightFor(rng: Rng, biome: Biome): string {
  return pick(rng, AMBIANCE[biome]);
}
export function ambientLine(rng: Rng): string {
  return pick(rng, AMBIENT);
}
export function enemyEntrance(rng: Rng, name: string): string {
  return pick(rng, ENEMY_ENTRANCE).replace("{n}", name);
}
export function hazardLine(rng: Rng, hazard: HazardKind): string {
  return pick(rng, hazard === "RADIATION" ? HAZARD_RAD : HAZARD_TOX);
}
export function searchNothing(rng: Rng): string {
  return pick(rng, SEARCH_NOTHING);
}
