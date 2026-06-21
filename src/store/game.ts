import { create } from "zustand";
import type { WorldSnapshot } from "@/lib/snapshot";

export type MobileTab = "map" | "info" | "feed";

interface GameState {
  snapshot: WorldSnapshot | null;
  selectedTerritoryId: string | null;
  selectedCountryIso: string | null;
  // First tap on a zone highlights it; a second tap opens its management screen.
  highlightedZoneId: string | null;
  mobileTab: MobileTab;
  setSnapshot: (s: WorldSnapshot | null) => void;
  selectTerritory: (id: string | null) => void;
  selectCountry: (iso: string | null) => void;
  highlightZone: (id: string | null) => void;
  setMobileTab: (t: MobileTab) => void;
  /** Close the panel: clear selection and return to the map view. */
  closeToMap: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  snapshot: null,
  selectedTerritoryId: null,
  selectedCountryIso: null,
  highlightedZoneId: null,
  mobileTab: "map",
  setSnapshot: (s) => set({ snapshot: s }),
  selectTerritory: (id) => set({ selectedTerritoryId: id }),
  selectCountry: (iso) => set({ selectedCountryIso: iso }),
  highlightZone: (id) => set({ highlightedZoneId: id }),
  setMobileTab: (t) => set({ mobileTab: t }),
  closeToMap: () => set({ selectedTerritoryId: null, selectedCountryIso: null, highlightedZoneId: null, mobileTab: "map" }),
}));
