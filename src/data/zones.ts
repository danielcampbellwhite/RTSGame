// The world is a fixed set of named zones plotted on the city map (overview).
// The shelter is the safe home zone; every other zone is a bounded grid of
// squares you explore. Danger and loot quality come from the zone's tier.

import type { FactionKey } from "@/data/factions";
import type { Biome } from "@/data/world";

export type ZoneType = "SAFE" | "POI" | "DANGER" | "WASTELAND";

export interface ZoneDef {
  key: string;
  name: string;
  type: ZoneType;
  x: number; // map position, 0–100 (% of the overview image)
  y: number;
  tier: number; // 0 (safe) .. 5 — drives danger + loot
  size: number; // grid is size × size
  biome: Biome;
  faction: FactionKey | null;
}

export const ZONES: ZoneDef[] = [
  { key: "shelter", name: "Player Shelter", type: "SAFE", x: 44, y: 82, tier: 0, size: 0, biome: "URBAN", faction: null },

  { key: "gas_station", name: "Gas Station", type: "POI", x: 27, y: 58, tier: 1, size: 6, biome: "URBAN", faction: null },
  { key: "suburbs", name: "Suburbs", type: "WASTELAND", x: 8, y: 45, tier: 1, size: 6, biome: "FOREST", faction: "RAIDERS" },

  { key: "hospital", name: "Hospital", type: "POI", x: 25, y: 40, tier: 2, size: 7, biome: "URBAN", faction: "COLLECTIVE" },
  { key: "abandoned_mall", name: "Abandoned Mall", type: "POI", x: 33, y: 15, tier: 2, size: 7, biome: "URBAN", faction: null },
  { key: "water_treatment", name: "Water Treatment", type: "POI", x: 13, y: 73, tier: 2, size: 7, biome: "INDUSTRIAL", faction: "COLLECTIVE" },
  { key: "collapsed_highway", name: "Collapsed Highway", type: "DANGER", x: 28, y: 70, tier: 2, size: 7, biome: "WASTES", faction: "RAIDERS" },

  { key: "downtown", name: "Downtown", type: "POI", x: 45, y: 42, tier: 3, size: 8, biome: "URBAN", faction: null },
  { key: "apartment_complex", name: "Apartment Complex", type: "POI", x: 63, y: 69, tier: 3, size: 8, biome: "URBAN", faction: "COLLECTIVE" },
  { key: "military_checkpoint", name: "Military Checkpoint", type: "WASTELAND", x: 54, y: 14, tier: 3, size: 8, biome: "INDUSTRIAL", faction: "WARDENS" },
  { key: "bridge_out", name: "Bridge Out", type: "DANGER", x: 58, y: 47, tier: 3, size: 7, biome: "WASTES", faction: "RAIDERS" },

  { key: "industrial_zone", name: "Industrial Zone", type: "POI", x: 80, y: 21, tier: 4, size: 9, biome: "INDUSTRIAL", faction: "WARDENS" },
  { key: "power_station", name: "Power Station", type: "POI", x: 78, y: 39, tier: 4, size: 9, biome: "INDUSTRIAL", faction: "WARDENS" },
  { key: "train_yard", name: "Train Yard", type: "POI", x: 80, y: 82, tier: 4, size: 9, biome: "INDUSTRIAL", faction: null },

  { key: "raider_camp", name: "Raider Camp", type: "DANGER", x: 87, y: 53, tier: 5, size: 9, biome: "IRRADIATED", faction: "RAIDERS" },
];

export const ZONES_BY_KEY: Record<string, ZoneDef> = Object.fromEntries(ZONES.map((z) => [z.key, z]));
export const ZONE_INDEX: Record<string, number> = Object.fromEntries(ZONES.map((z, i) => [z.key, i]));

export const ZONE_TYPE_META: Record<ZoneType, { icon: string; color: string; label: string }> = {
  SAFE: { icon: "🏠", color: "#7bbf5a", label: "Safe Zone" },
  POI: { icon: "⭐", color: "#e0a32e", label: "Point of Interest" },
  DANGER: { icon: "💀", color: "#b13838", label: "Danger Zone" },
  WASTELAND: { icon: "☠️", color: "#9aa3ab", label: "Wasteland" },
};
