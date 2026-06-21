"use client";

import { useGameStore } from "@/store/game";

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (abs >= 1) return n.toFixed(0);
  return n.toFixed(1);
}

// GDP is already denominated in billions; roll over to trillions past 1,000b
// so it never reads as the confusing "kb" (thousand-billions).
function fmtGdp(billions: number): string {
  if (Math.abs(billions) >= 1000) return `$${(billions / 1000).toFixed(2)}t`;
  return `$${billions.toFixed(0)}b`;
}

type ResourceMap = NonNullable<ReturnType<typeof useGameStore.getState>["snapshot"]>["player"]["resources"];

const RESOURCES: { key: keyof ResourceMap; label: string; color: string }[] = [
  { key: "money", label: "Treasury", color: "#34d399" },
  { key: "oil", label: "Oil", color: "#fbbf24" },
  { key: "food", label: "Food", color: "#a3e635" },
  { key: "electricity", label: "Power", color: "#22d3ee" },
  { key: "steel", label: "Steel", color: "#94a3b8" },
  { key: "rareMaterials", label: "Rare", color: "#f0f" },
  { key: "manpower", label: "Manpwr", color: "#fb7185" },
];

export default function ResourceBar() {
  const snapshot = useGameStore((s) => s.snapshot);
  if (!snapshot) return null;
  const { player } = snapshot;

  return (
    <div className="panel glow-border flex items-stretch gap-3 overflow-x-auto scroll-thin px-3 py-2">
      {/* Country identity */}
      <div className="flex shrink-0 flex-col justify-center leading-tight">
        <span className="neon-text text-base font-bold text-[var(--wd-magenta)]">{player.name}</span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-300/75">{player.iso3} · World Dominion</span>
      </div>

      <Divider />

      {/* National standing */}
      <Chip label="GDP" value={fmtGdp(player.gdp)} color="#7fe9f7" />
      <Chip label="Stability" value={player.stability.toFixed(0)} color={stat(player.stability)} bar={player.stability} />
      <Chip label="Morale" value={player.morale.toFixed(0)} color={stat(player.morale)} bar={player.morale} />
      <Chip label="Influence" value={player.influence.toFixed(0)} color="#c4b5fd" />
      <Chip label="Tech" value={player.techLevel.toFixed(0)} color="#67e8f9" />

      <Divider />

      {/* Resource stockpiles */}
      {RESOURCES.map((r) => (
        <Chip key={r.key} label={r.label} value={fmt(player.resources[r.key])} color={r.color} />
      ))}
    </div>
  );
}

function stat(v: number): string {
  if (v >= 60) return "#34d399";
  if (v >= 35) return "#fbbf24";
  return "#ef4444";
}

function Divider() {
  return <div className="my-1 w-px shrink-0 bg-[var(--wd-border)]" />;
}

function Chip({ label, value, color, bar }: { label: string; value: string; color: string; bar?: number }) {
  return (
    <div className="flex min-w-[58px] shrink-0 flex-col justify-center">
      <span className="text-[9px] uppercase tracking-wide text-cyan-200/70">{label}</span>
      <span className="neon-text text-sm font-bold" style={{ color }}>
        {value}
      </span>
      {bar !== undefined && (
        <div className="mt-0.5 h-[3px] w-full rounded bg-[var(--wd-border)]">
          <div className="h-full rounded" style={{ width: `${Math.min(100, Math.max(0, bar))}%`, background: color }} />
        </div>
      )}
    </div>
  );
}
