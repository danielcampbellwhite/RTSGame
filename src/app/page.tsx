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
  const selectedTerritoryId = useGameStore((s) => s.selectedTerritoryId);
  const selectedCountryIso = useGameStore((s) => s.selectedCountryIso);
  const [gameId, setGameId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [mobileTab, setMobileTab] = useState<"map" | "info" | "feed">("map");

  // Tapping something on the map should reveal the control sheet on mobile.
  useEffect(() => {
    if (selectedTerritoryId || selectedCountryIso) setMobileTab("info");
  }, [selectedTerritoryId, selectedCountryIso]);

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

  // Mobile sheet wrappers: full-screen overlays toggled by the bottom tab bar;
  // on md+ they revert to their normal grid cells.
  const sheet = (active: boolean) =>
    `min-h-0 ${
      active ? "fixed inset-x-2 bottom-16 top-16 z-30" : "hidden"
    } md:static md:inset-auto md:bottom-auto md:top-auto md:z-auto md:block`;

  return (
    <div className="flex h-[100dvh] w-screen flex-col gap-2 p-2">
      <ResourceBar />

      <div className="relative flex min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-[1fr_340px] md:grid-rows-[minmax(0,1fr)_7rem]">
        {/* Map */}
        <div className="panel glow-border relative min-h-0 flex-1 overflow-hidden md:col-start-1 md:row-start-1">
          <WorldMap />
        </div>

        {/* Control panel — desktop top-right, mobile slide-up sheet */}
        <div className={`${sheet(mobileTab === "info")} md:col-start-2 md:row-start-1`}>
          <InfoPanel />
        </div>

        {/* Event feed — desktop full-width bottom, mobile slide-up sheet */}
        <div className={`${sheet(mobileTab === "feed")} md:col-span-2 md:col-start-1 md:row-start-2`}>
          <EventFeed />
        </div>
      </div>

      {/* Mobile-only tab bar */}
      <div className="flex shrink-0 gap-1 md:hidden">
        {(["map", "info", "feed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={`panel flex-1 rounded py-2 text-[11px] uppercase tracking-widest ${
              mobileTab === t ? "text-[var(--wd-cyan)] glow-border" : "text-cyan-200/50"
            }`}
          >
            {t === "map" ? "Map" : t === "info" ? "Command" : "Feed"}
          </button>
        ))}
      </div>
    </div>
  );
}

function StartScreen({ onStart }: { onStart: (iso: string) => void }) {
  const [query, setQuery] = useState("");
  const list = COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="flex h-[100dvh] w-screen flex-col items-center justify-center gap-4 p-4 sm:p-6">
      <h1 className="neon-text text-center text-2xl font-bold tracking-widest text-[var(--wd-magenta)] sm:text-3xl">
        WORLD DOMINION
      </h1>
      <p className="text-center text-xs text-cyan-200/60 sm:text-sm">
        Choose the nation you will command. Every other country is AI.
      </p>
      <input
        autoFocus
        placeholder="Search nations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="panel glow-border w-full max-w-xs rounded px-3 py-2 text-sm outline-none"
      />
      <div className="grid max-h-[55vh] w-full max-w-2xl grid-cols-2 gap-1 overflow-y-auto scroll-thin sm:grid-cols-3">
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
    <div className="flex h-[100dvh] w-screen items-center justify-center px-4 text-center text-sm text-cyan-200/60">
      <span className="pulse">{children}</span>
    </div>
  );
}
