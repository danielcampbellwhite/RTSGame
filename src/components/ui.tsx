"use client";

import { useTransition } from "react";
import { useGame } from "@/store/game";
import type { GameSnapshot } from "@/lib/types";

/** Run a server action and push its snapshot result into the store. */
export function useAction() {
  const setSnapshot = useGame((s) => s.setSnapshot);
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<GameSnapshot | null>) =>
    startTransition(async () => {
      const next = await fn();
      if (next) setSnapshot(next);
    });
  return { run, isPending };
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
  className = "",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "go";
  className?: string;
  title?: string;
}) {
  const v = variant === "danger" ? "btn-danger" : variant === "go" ? "btn-go" : "";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`btn rounded px-3 py-2 text-xs ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function Meter({ label, value, max, color, critical }: { label: string; value: number; max: number; color: string; critical?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`text-[0.66rem] ${critical ? "pulse" : ""}`}>
      <div className="flex justify-between text-[var(--ink-dim)]">
        <span className="title" style={critical ? { color } : undefined}>{label}</span>
        <span style={{ color }}>{Math.round(value)}{max === 100 ? "" : `/${max}`}</span>
      </div>
      <div className="meter mt-0.5" style={critical ? { borderColor: color, boxShadow: `0 0 6px ${color}` } : undefined}>
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const RES_META: Record<string, { icon: string; color: string }> = {
  food: { icon: "🥫", color: "#d9b15a" },
  water: { icon: "🚰", color: "#5aa9d9" },
  meds: { icon: "💊", color: "#d96a8a" },
  ammo: { icon: "🧨", color: "#c2752f" },
  scrap: { icon: "🔩", color: "#9aa3ab" },
  fuel: { icon: "⛽", color: "#c2521f" },
};

export function ResourceChip({ k, value }: { k: string; value: number }) {
  const m = RES_META[k] ?? { icon: "?", color: "#aaa" };
  const low = value < 15;
  return (
    <div className="inset flex items-center gap-1 rounded px-2 py-1" title={k}>
      <span>{m.icon}</span>
      <span className="text-xs" style={{ color: low ? "var(--blood)" : m.color }}>
        {Math.round(value)}
      </span>
    </div>
  );
}
