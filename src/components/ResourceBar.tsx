"use client";

import { useGameStore } from "@/store/game";

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (abs >= 1) return n.toFixed(0);
  return n.toFixed(1);
}

const RESOURCES: { key: keyof ResourceMap; label: string; color: string }[] = [
  { key: "money", label: "₵ Treasury", color: "#34d399" },
  { key: "oil", label: "Oil", color: "#fbbf24" },
  { key: "food", label: "Food", color: "#a3e635" },
  { key: "electricity", label: "Power", color: "#22d3ee" },
  { key: "steel", label: "Steel", color: "#94a3b8" },
  { key: "rareMaterials", label: "Rare", color: "#f0f" },
  { key: "manpower", label: "Manpower", color: "#fb7185" },
];

type ResourceMap = NonNullable<ReturnType<typeof useGameStore.getState>["snapshot"]>["player"]["resources"];

export default function ResourceBar() {
  const snapshot = useGameStore((s) => s.snapshot);
  if (!snapshot) return null;
  const { player } = snapshot;

  return (
    <div className="panel glow-border flex shrink-0 items-center gap-1 overflow-x-auto scroll-thin px-3 py-2 text-xs">
      <div className="mr-3 flex shrink-0 flex-col">
        <span className="neon-text text-sm font-bold text-[var(--wd-magenta)]">{player.name}</span>
        <span className="text-[10px] text-cyan-300/60">WORLD DOMINION</span>
      </div>
      {RESOURCES.map((r) => (
        <div key={r.key} className="flex w-[64px] shrink-0 flex-col items-start border-l border-[var(--wd-border)] px-2">
          <span className="text-[10px] uppercase tracking-wide text-cyan-200/50">{r.label}</span>
          <span className="neon-text font-bold" style={{ color: r.color }}>
            {fmt(player.resources[r.key])}
          </span>
        </div>
      ))}
      <div className="flex shrink-0 gap-3 pl-2 text-[10px] md:ml-auto md:pl-0">
        <Stat label="GDP" value={`$${fmt(player.gdp)}b`} />
        <Stat label="Stab" value={player.stability.toFixed(0)} />
        <Stat label="Morale" value={player.morale.toFixed(0)} />
        <Stat label="Infl" value={player.influence.toFixed(0)} />
        <Stat label="Tech" value={player.techLevel.toFixed(0)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-cyan-200/40">{label}</span>
      <span className="neon-text text-cyan-200">{value}</span>
    </div>
  );
}
