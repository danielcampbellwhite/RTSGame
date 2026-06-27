// Per-expedition conditions — the wasteland's "weather/threat" for a run,
// rolled when you set out. Makes every trip feel different and alive.

import { weighted, type Rng } from "@/lib/rng";

export type Condition = "CLEAR" | "RAD_STORM" | "RAIDER_ACTIVITY" | "BOUNTIFUL" | "CARAVAN";

export interface ConditionDef {
  key: Condition;
  name: string;
  icon: string;
  note: string;
}

export const CONDITIONS: Record<Condition, ConditionDef> = {
  CLEAR: { key: "CLEAR", name: "Clear Skies", icon: "🌤️", note: "Nothing unusual on the wind." },
  RAD_STORM: { key: "RAD_STORM", name: "Radiation Storm", icon: "☢️", note: "Fallout is whipping up — radiation hits far harder." },
  RAIDER_ACTIVITY: { key: "RAIDER_ACTIVITY", name: "Raider Activity", icon: "💀", note: "Hostiles are out in force. Expect ambushes." },
  BOUNTIFUL: { key: "BOUNTIFUL", name: "Bountiful Ruins", icon: "✨", note: "Untouched caches — richer loot than usual." },
  CARAVAN: { key: "CARAVAN", name: "Caravan Routes", icon: "🧑‍🔧", note: "Traders are travelling. More chances to barter." },
};

export function rollCondition(rng: Rng): Condition {
  return weighted<Condition>(rng, [
    ["CLEAR", 5],
    ["RAD_STORM", 2],
    ["RAIDER_ACTIVITY", 2],
    ["BOUNTIFUL", 2],
    ["CARAVAN", 2],
  ]);
}
