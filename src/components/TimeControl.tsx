"use client";

import { useTransition } from "react";
import { useGameStore } from "@/store/game";
import { setPaused, setSpeed } from "@/app/actions";

const SPEEDS = [1, 2, 5];

export default function TimeControl() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [isPending, startTransition] = useTransition();
  if (!snapshot) return null;

  const { paused, speed, ageDays } = snapshot.game;
  const run = (fn: () => Promise<typeof snapshot | null>) =>
    startTransition(async () => {
      const next = await fn();
      if (next) setSnapshot(next);
    });

  return (
    <div className="panel glow-border flex items-center justify-center gap-3 px-3 py-2">
      {/* Day counter */}
      <div className="flex flex-col items-center leading-none">
        <span className="text-[9px] uppercase tracking-widest text-cyan-200/40">Day</span>
        <span className="neon-text text-xl font-bold text-[var(--wd-cyan)]">{Math.floor(ageDays)}</span>
      </div>

      {/* Pause / resume */}
      <button
        onClick={() => run(() => setPaused(snapshot.gameId, !paused))}
        disabled={isPending}
        className="flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg disabled:opacity-40"
        style={{
          borderColor: paused ? "var(--wd-amber)" : "var(--wd-green)",
          color: paused ? "var(--wd-amber)" : "var(--wd-green)",
        }}
        title={paused ? "Resume" : "Pause"}
      >
        {paused ? "▶" : "❚❚"}
      </button>

      {/* Speed selector */}
      <div className="flex items-center gap-1">
        {SPEEDS.map((s) => {
          const active = !paused && speed === s;
          return (
            <button
              key={s}
              onClick={() => run(() => setSpeed(snapshot.gameId, s))}
              disabled={isPending}
              className={`h-10 w-10 rounded text-sm font-bold disabled:opacity-40 ${
                active
                  ? "bg-[var(--wd-cyan)]/20 text-[var(--wd-cyan)] glow-border"
                  : "border border-[var(--wd-border)] text-cyan-200/50"
              }`}
            >
              {s}×
            </button>
          );
        })}
      </div>

      {/* Live / paused status */}
      <div className="flex items-center gap-1.5">
        <span
          className={`h-2 w-2 rounded-full ${paused ? "" : "pulse"}`}
          style={{ background: paused ? "var(--wd-amber)" : "var(--wd-green)" }}
        />
        <span
          className="text-[10px] uppercase tracking-widest"
          style={{ color: paused ? "var(--wd-amber)" : "var(--wd-green)" }}
        >
          {paused ? "Paused" : "Live"}
        </span>
      </div>
    </div>
  );
}
