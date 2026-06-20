"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useGameStore } from "@/store/game";
import { createGame, fetchSnapshot } from "@/app/actions";
import { COUNTRIES } from "@/data/countries";
import ResourceBar from "@/components/ResourceBar";
import InfoPanel from "@/components/InfoPanel";
import EventFeed from "@/components/EventFeed";

const WorldMap = dynamic(() => import("@/components/WorldMap"), { ssr: false });

const STORAGE_KEY = "wd_game_id";

export default function Page() {
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const snapshot = useGameStore((s) => s.snapshot);
  const [gameId, setGameId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // Resolve the active game (from localStorage) on mount.
  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    setGameId(id);
    setBooting(false);
  }, []);

  const refresh = useCallback(
    async (id: string) => {
      const snap = await fetchSnapshot(id);
      if (!snap) {
        localStorage.removeItem(STORAGE_KEY);
        setGameId(null);
        return;
      }
      setSnapshot(snap);
    },
    [setSnapshot]
  );

  // Load + poll the world while a game is active.
  useEffect(() => {
    if (!gameId) return;
    refresh(gameId);
    const t = setInterval(() => refresh(gameId), 15_000);
    return () => clearInterval(t);
  }, [gameId, refresh]);

  const start = async (iso: string) => {
    setBooting(true);
    const id = await createGame(iso, "Commander");
    localStorage.setItem(STORAGE_KEY, id);
    setGameId(id);
    setBooting(false);
  };

  if (booting) return <Center>Initialising command center…</Center>;
  if (!gameId) return <StartScreen onStart={start} />;
  if (!snapshot) return <Center>Syncing world state…</Center>;

  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr_auto] gap-2 p-2">
      <ResourceBar />
      <div className="grid min-h-0 grid-cols-[1fr_320px] gap-2">
        <div className="panel glow-border relative overflow-hidden">
          <WorldMap />
        </div>
        <InfoPanel />
      </div>
      <div className="h-32">
        <EventFeed />
      </div>
    </div>
  );
}

function StartScreen({ onStart }: { onStart: (iso: string) => void }) {
  const [query, setQuery] = useState("");
  const list = COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="neon-text text-3xl font-bold tracking-widest text-[var(--wd-magenta)]">WORLD DOMINION</h1>
      <p className="text-sm text-cyan-200/60">Choose the nation you will command. Every other country is AI.</p>
      <input
        autoFocus
        placeholder="Search nations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="panel glow-border w-80 rounded px-3 py-2 text-sm outline-none"
      />
      <div className="grid max-h-[50vh] w-[40rem] grid-cols-3 gap-1 overflow-y-auto scroll-thin">
        {list.map((c) => (
          <button
            key={c.iso3}
            onClick={() => onStart(c.iso3)}
            className="panel rounded px-2 py-1.5 text-left text-xs hover:border-[var(--wd-cyan)] hover:text-[var(--wd-cyan)]"
          >
            <span className="neon-text">{c.name}</span>
            {c.super && <span className="ml-1 text-[9px] text-[var(--wd-magenta)]">★</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center text-sm text-cyan-200/60">
      <span className="pulse">{children}</span>
    </div>
  );
}
