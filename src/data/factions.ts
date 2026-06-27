// Wasteland factions. Regions of the map are controlled by a faction (or
// unclaimed). The player builds standing with each through their actions, which
// changes how that faction's members treat them.

import { mulberry32, hashSeed, weighted, type Rng } from "@/lib/rng";

export type FactionKey = "RAIDERS" | "COLLECTIVE" | "WARDENS";

export interface FactionDef {
  key: FactionKey;
  name: string;
  icon: string;
  color: string;
  note: string;
}

export const FACTIONS: Record<FactionKey, FactionDef> = {
  RAIDERS: { key: "RAIDERS", name: "The Skulls", icon: "💀", color: "#b13838", note: "Brutal raider clans. They take what they want." },
  COLLECTIVE: { key: "COLLECTIVE", name: "The Collective", icon: "⚙️", color: "#8fbf3f", note: "Traders and settlers rebuilding the old world." },
  WARDENS: { key: "WARDENS", name: "Iron Wardens", icon: "🛡️", color: "#5aa9d9", note: "A militarized order that polices its turf." },
};

export const FACTION_KEYS = Object.keys(FACTIONS) as FactionKey[];

/** Rival each faction loses/gains standing against when you cross the other. */
export const RIVAL: Record<FactionKey, FactionKey> = {
  RAIDERS: "WARDENS",
  WARDENS: "RAIDERS",
  COLLECTIVE: "RAIDERS",
};

/** Which faction controls the ~5x5 region containing (x,y), or null if wild. */
export function factionAt(seed: number, x: number, y: number): FactionKey | null {
  const r: Rng = mulberry32(hashSeed(seed + 101, Math.floor(x / 5), Math.floor(y / 5)));
  const pick = weighted<FactionKey | "NONE">(r, [
    ["NONE", 3],
    ["RAIDERS", 3],
    ["COLLECTIVE", 2],
    ["WARDENS", 2],
  ]);
  return pick === "NONE" ? null : pick;
}

export type RepMap = Partial<Record<FactionKey, number>>;

export function repOf(rep: RepMap, f: FactionKey | null): number {
  return f ? rep[f] ?? 0 : 0;
}

/** Standing label for a rep value (−100..100). */
export function standing(v: number): string {
  if (v >= 60) return "Allied";
  if (v >= 25) return "Friendly";
  if (v > -25) return "Neutral";
  if (v > -60) return "Disliked";
  return "Hostile";
}
