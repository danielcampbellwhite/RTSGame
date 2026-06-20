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
    <div className="panel glow-border flex shrink-0 items-center gap-2 px-2 py-2 text-xs">
      <div className="flex flex-col items-center leading-tight">
        <span className="text-[9px] uppercase tracking-widest text-cyan-200/40">Day</span>
        <span className="neon-text font-bold text-[var(--wd-cyan)]">{Math.floor(ageDays)}</span>
      </div>
      <button
        onClick={() => run(() => setPaused(snapshot.gameId, !paused))}
        disabled={isPending}
        className="rounded border border-[var(--wd-border)] px-2 py-1 hover:border-[var(--wd-cyan)] disabled:opacity-40"
        style={{ color: paused ? "var(--wd-amber)" : "var(--wd-green)" }}
        title={paused ? "Resume" : "Pause"}
      >
        {paused ? "▶" : "❚❚"}
      </button>
      <div className="flex items-center gap-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => run(() => setSpeed(snapshot.gameId, s))}
            disabled={isPending}
            className={`rounded px-1.5 py-1 text-[10px] ${
              !paused && speed === s ? "bg-[var(--wd-cyan)]/20 text-[var(--wd-cyan)]" : "text-cyan-200/40"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className={`text-[9px] uppercase tracking-widest ${paused ? "text-[var(--wd-amber)]" : "text-[var(--wd-green)] pulse"}`}>
        {paused ? "Paused" : "Live"}
      </span>
    </div>
  );
}
