import { create } from "zustand";
import type { GameSnapshot } from "@/lib/types";

interface State {
  playerId: string | null;
  snapshot: GameSnapshot | null;
  setPlayerId: (id: string | null) => void;
  setSnapshot: (s: GameSnapshot | null) => void;
}

export const useGame = create<State>((set) => ({
  playerId: null,
  snapshot: null,
  setPlayerId: (playerId) => set({ playerId }),
  setSnapshot: (snapshot) => set({ snapshot }),
}));

export const PID_KEY = "aftermath_pid";
