// Crafting recipes. Inputs may draw from shelter resource counters and/or
// storage material items; outputs are storage item stacks.

import type { ResourceKey } from "@/lib/game";

export type Station = "workshop" | "medical" | "ammoBench" | "weaponBench";

export interface Recipe {
  key: string;
  name: string;
  station: Station;
  stationLvl: number;
  resources?: Partial<Record<ResourceKey, number>>;
  items?: { defKey: string; qty: number }[];
  output: { defKey: string; qty: number };
}

export const RECIPES: Recipe[] = [
  { key: "make_bandage", name: "Bandages ×3", station: "medical", stationLvl: 1, resources: { meds: 2 }, output: { defKey: "bandage", qty: 3 } },
  { key: "make_medkit", name: "Medkit", station: "medical", stationLvl: 1, items: [{ defKey: "bandage", qty: 2 }], resources: { meds: 3 }, output: { defKey: "medkit", qty: 1 } },
  { key: "make_stim", name: "Stimpack", station: "medical", stationLvl: 1, items: [{ defKey: "electronics", qty: 1 }], resources: { meds: 2 }, output: { defKey: "stim", qty: 1 } },
  { key: "make_knife", name: "Combat Knife", station: "workshop", stationLvl: 1, resources: { scrap: 4 }, output: { defKey: "knife", qty: 1 } },
  { key: "make_vest", name: "Kevlar Vest", station: "workshop", stationLvl: 2, resources: { scrap: 8 }, items: [{ defKey: "cloth", qty: 3 }], output: { defKey: "vest", qty: 1 } },
];

// Upgrade costs (scrap/fuel/meds) by target level.
export function upgradeCost(targetLevel: number): { scrap: number; fuel: number } {
  return { scrap: 10 * targetLevel, fuel: 3 * targetLevel };
}
