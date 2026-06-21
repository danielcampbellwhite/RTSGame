import { create } from "zustand";
import type { WorldSnapshot } from "@/lib/snapshot";

interface GameState {
  snapshot: WorldSnapshot | null;
  selectedTerritoryId: string | null;
  selectedCountryIso: string | null;
  // First tap on a zone highlights it; a second tap opens its management screen.
  highlightedZoneId: string | null;
  setSnapshot: (s: WorldSnapshot | null) => void;
  selectTerritory: (id: string | null) => void;
  selectCountry: (iso: string | null) => void;
  highlightZone: (id: string | null) => void;
}

export const useGameStore = create<GameState>((set) => ({
  snapshot: null,
  selectedTerritoryId: null,
  selectedCountryIso: null,
  highlightedZoneId: null,
  setSnapshot: (s) => set({ snapshot: s }),
  selectTerritory: (id) => set({ selectedTerritoryId: id }),
  selectCountry: (iso) => set({ selectedCountryIso: iso }),
  highlightZone: (id) => set({ highlightedZoneId: id }),
}));
