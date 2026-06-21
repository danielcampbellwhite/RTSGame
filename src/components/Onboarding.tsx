"use client";

import { useGameStore } from "@/store/game";

export default function Onboarding({ onClose }: { onClose: () => void }) {
  const snapshot = useGameStore((s) => s.snapshot);
  if (!snapshot) return null;
  const r = snapshot.rankings;

  return (
    <div className="fixed left-0 top-0 z-50 flex h-full w-full items-center justify-center bg-black/70 p-4">
      <div className="panel glow-border max-h-[85vh] w-full max-w-md overflow-y-auto scroll-thin p-5">
        <h2 className="neon-text mb-1 text-lg font-bold text-[var(--wd-magenta)]">
          You command {snapshot.player.name}
        </h2>
        <p className="mb-3 text-xs text-cyan-200/80">
          A persistent real-time world. It keeps running even when you log off — log back in and time has passed.
        </p>

        <div className="mb-3 grid grid-cols-3 gap-1 text-center text-xs">
          <Standing label="GDP" rank={r.gdp} total={r.total} />
          <Standing label="Influence" rank={r.influence} total={r.total} />
          <Standing label="Territory" rank={r.territory} total={r.total} />
        </div>

        <ul className="mb-4 space-y-1.5 text-xs text-cyan-200/90">
          <li>💰 <b>Economy is power.</b> Use <b>Command → Policy</b> to balance tax and spending. Don't run a deficit.</li>
          <li>🏗️ <b>Build.</b> Tap one of your territory rings on the map to construct factories, farms and bases.</li>
          <li>⚔️ <b>Military.</b> Recruit units and march on rivals from the <b>Military</b> tab.</li>
          <li>🤝 <b>Diplomacy &amp; trade.</b> Improve relations, embargo, or open trade routes.</li>
          <li>🔬 <b>Research.</b> Spend your research budget on the tech tree.</li>
          <li>⏱️ <b>Time.</b> Pause or speed up with the controls top-left.</li>
        </ul>
        <p className="mb-3 text-[11px] text-cyan-200/70">
          There's no single win condition — climb the rankings, dominate a region, or just survive.
        </p>

        <SaveCode code={snapshot.gameId} />

        <button
          onClick={onClose}
          className="mt-3 w-full rounded border border-[var(--wd-cyan)] py-2 text-sm text-[var(--wd-cyan)] hover:bg-[var(--wd-cyan)]/10"
        >
          Take Command
        </button>
      </div>
    </div>
  );
}

function SaveCode({ code }: { code: string }) {
  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
  };
  return (
    <div className="rounded border border-[var(--wd-border)] p-2">
      <div className="text-[9px] uppercase tracking-widest text-cyan-200/70">
        Save code — copy this to resume on another device
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate text-[11px] text-cyan-200/90">{code}</code>
        <button onClick={copy} className="rounded border border-[var(--wd-border)] px-2 py-0.5 text-[10px] hover:border-[var(--wd-cyan)] hover:text-[var(--wd-cyan)]">
          Copy
        </button>
      </div>
    </div>
  );
}

function Standing({ label, rank, total }: { label: string; rank: number; total: number }) {
  return (
    <div className="rounded border border-[var(--wd-border)] py-1">
      <div className="text-[9px] uppercase tracking-widest text-cyan-200/70">{label}</div>
      <div className="neon-text text-[var(--wd-cyan)]">
        #{rank}
        <span className="text-[9px] text-cyan-200/70">/{total}</span>
      </div>
    </div>
  );
}
