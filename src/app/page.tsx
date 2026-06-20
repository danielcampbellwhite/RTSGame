"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useGameStore } from "@/store/game";
import { createGame, fetchSnapshot } from "@/app/actions";
import { COUNTRIES } from "@/data/countries";
import ResourceBar from "@/components/ResourceBar";
import InfoPanel from "@/components/InfoPanel";
import EventFeed from "@/components/EventFeed";
import TimeControl from "@/components/TimeControl";
import Onboarding from "@/components/Onboarding";
import { playBlip } from "@/lib/sound";

const ONBOARD_KEY = "wd_onboarded";
const MUTE_KEY = "wd_muted";

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
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [unread, setUnread] = useState(0);
  const [muted, setMuted] = useState(false);
  const lastTopEvent = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setMuted(localStorage.getItem(MUTE_KEY) === "1");
  }, []);

  // Detect new feed entries → blip + (on mobile) unread badge.
  useEffect(() => {
    const events = snapshot?.events ?? [];
    const top = events[0]?.id ?? null;
    if (!top) return;
    if (lastTopEvent.current === null) {
      lastTopEvent.current = top; // first load: don't notify
      return;
    }
    if (top !== lastTopEvent.current) {
      let n = 0;
      for (const e of events) {
        if (e.id === lastTopEvent.current) break;
        n++;
      }
      lastTopEvent.current = top;
      if (n > 0) {
        if (!muted) playBlip();
        if (typeof window !== "undefined" && !window.matchMedia("(min-width:768px)").matches) {
          setUnread((u) => u + n);
        }
      }
    }
  }, [snapshot, muted]);

  useEffect(() => {
    if (mobileTab === "feed") setUnread(0);
  }, [mobileTab]);

  const toggleMute = () =>
    setMuted((m) => {
      const v = !m;
      if (typeof window !== "undefined") localStorage.setItem(MUTE_KEY, v ? "1" : "0");
      return v;
    });

  // Tapping something on the map should reveal the control sheet on mobile.
  useEffect(() => {
    if (selectedTerritoryId || selectedCountryIso) setMobileTab("info");
  }, [selectedTerritoryId, selectedCountryIso]);

  // Show the intro once per browser the first time a world is loaded.
  useEffect(() => {
    if (snapshot && typeof window !== "undefined" && !localStorage.getItem(ONBOARD_KEY)) {
      setShowOnboarding(true);
    }
  }, [snapshot]);

  const closeOnboarding = () => {
    localStorage.setItem(ONBOARD_KEY, "1");
    setShowOnboarding(false);
  };

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

  // Resume an existing save by its code (the game id). Returns false if invalid.
  const resume = async (code: string): Promise<boolean> => {
    const trimmed = code.trim();
    if (!trimmed) return false;
    setBooting(true);
    const snap = await fetchSnapshot(trimmed);
    if (snap) {
      localStorage.setItem(STORAGE_KEY, trimmed);
      setGameId(trimmed);
      return true;
    }
    setBooting(false);
    return false;
  };

  if (booting) return <Center>Initialising command center…</Center>;
  if (!gameId) return <StartScreen onStart={start} onResume={resume} />;
  if (!snapshot) return <Center>Syncing world state…</Center>;

  // Mobile sheet wrappers: full-screen overlays toggled by the bottom tab bar;
  // on md+ they revert to their normal grid cells.
  const sheet = (active: boolean) =>
    `min-h-0 ${
      active ? "fixed inset-x-2 bottom-16 top-16 z-30" : "hidden"
    } md:static md:inset-auto md:bottom-auto md:top-auto md:z-auto md:block`;

  return (
    <div className="fixed inset-0 grid grid-rows-[auto_1fr_auto] gap-2 p-2">
      {showOnboarding && <Onboarding onClose={closeOnboarding} />}

      <div className="flex shrink-0 gap-2">
        <TimeControl />
        <div className="min-w-0 flex-1">
          <ResourceBar />
        </div>
      </div>

      <div className="relative min-h-0 md:grid md:grid-cols-[1fr_340px] md:grid-rows-[minmax(0,1fr)_7rem] md:gap-2">
        {/* Map — fills its grid row via absolute positioning (mobile) or the
            grid cell (desktop), so its height never depends on flex-grow. */}
        <div className="panel glow-border absolute inset-0 overflow-hidden md:static md:relative md:inset-auto md:col-start-1 md:row-start-1">
          <WorldMap />
          <button
            onClick={() => setShowOnboarding(true)}
            className="panel absolute bottom-2 right-2 z-10 h-7 w-7 rounded-full text-sm text-cyan-200/70 hover:text-[var(--wd-cyan)]"
            title="Help"
          >
            ?
          </button>
        </div>

        {/* Control panel — desktop top-right, mobile slide-up sheet */}
        <div className={`${sheet(mobileTab === "info")} md:col-start-2 md:row-start-1`}>
          <InfoPanel />
        </div>

        {/* Event feed — desktop full-width bottom, mobile slide-up sheet */}
        <div className={`${sheet(mobileTab === "feed")} md:col-span-2 md:col-start-1 md:row-start-2`}>
          <EventFeed muted={muted} onToggleMute={toggleMute} />
        </div>
      </div>

      {/* Mobile-only tab bar */}
      <div className="flex shrink-0 gap-1 md:hidden">
        {(["map", "info", "feed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={`panel relative flex-1 rounded py-2 text-[11px] uppercase tracking-widest ${
              mobileTab === t ? "text-[var(--wd-cyan)] glow-border" : "text-cyan-200/50"
            }`}
          >
            {t === "map" ? "Map" : t === "info" ? "Command" : "Feed"}
            {t === "feed" && unread > 0 && (
              <span className="pulse absolute right-1 top-1 min-w-4 rounded-full bg-[var(--wd-red)] px-1 text-[9px] leading-4 text-white">
                {unread}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function StartScreen({ onStart, onResume }: { onStart: (iso: string) => void; onResume: (code: string) => Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [resumeError, setResumeError] = useState(false);
  const list = COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  const tryResume = async () => {
    setResumeError(false);
    const ok = await onResume(code);
    if (!ok) setResumeError(true);
  };
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto p-4 sm:p-6">
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

      <div className="mt-2 flex w-full max-w-xs flex-col items-center gap-1">
        <div className="text-[10px] uppercase tracking-widest text-cyan-200/40">Resume a save</div>
        <div className="flex w-full gap-1">
          <input
            placeholder="Paste save code…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="panel flex-1 rounded px-2 py-1.5 text-xs outline-none"
          />
          <button
            onClick={tryResume}
            className="rounded border border-[var(--wd-cyan)] px-3 text-xs text-[var(--wd-cyan)] hover:bg-[var(--wd-cyan)]/10"
          >
            Load
          </button>
        </div>
        {resumeError && <div className="text-[10px] text-[var(--wd-red)]">No save found for that code.</div>}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center px-4 text-center text-sm text-cyan-200/60">
      <span className="pulse">{children}</span>
    </div>
  );
}
