"use client";

import { useEffect, useState, useTransition } from "react";
import { useGameStore } from "@/store/game";
import { setBudget, queueBuilding } from "@/app/actions";
import type { BuildingType } from "@prisma/client";

const BUILD_OPTIONS: { type: BuildingType; label: string }[] = [
  { type: "HOUSING", label: "Housing" },
  { type: "FARM", label: "Farm" },
  { type: "FACTORY", label: "Factory" },
  { type: "POWER_PLANT", label: "Power Plant" },
  { type: "BARRACKS", label: "Barracks" },
  { type: "AIR_BASE", label: "Air Base" },
];

export default function InfoPanel() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const selectedTerritoryId = useGameStore((s) => s.selectedTerritoryId);
  const selectedCountryIso = useGameStore((s) => s.selectedCountryIso);
  const [isPending, startTransition] = useTransition();

  if (!snapshot) return <Shell>Loading command center…</Shell>;

  const territory = snapshot.territories.find((t) => t.id === selectedTerritoryId);
  const country = snapshot.countries.find((c) => c.iso3 === selectedCountryIso);

  const build = (type: BuildingType) => {
    if (!territory) return;
    startTransition(async () => {
      const next = await queueBuilding(snapshot.gameId, territory.id, type);
      if (next) setSnapshot(next);
    });
  };

  if (territory) {
    return (
      <Shell title={territory.name} subtitle={territory.kind}>
        <Bar label="Population" value={`${territory.population.toFixed(1)}M`} />
        <Bar label="Morale" value={territory.morale.toFixed(0)} pct={territory.morale} />
        <Bar label="Unrest" value={territory.unrest.toFixed(0)} pct={territory.unrest} danger />
        <Bar label="Control" value={`${territory.controlPct.toFixed(0)}%`} pct={territory.controlPct} />
        {territory.occupied && <div className="text-xs text-[var(--wd-red)]">⚠ Under occupation</div>}
        <div className="mt-3 text-[10px] uppercase tracking-widest text-cyan-200/50">Construction</div>
        <div className="grid grid-cols-2 gap-1">
          {BUILD_OPTIONS.map((b) => (
            <button
              key={b.type}
              disabled={isPending}
              onClick={() => build(b.type)}
              className="rounded border border-[var(--wd-border)] px-2 py-1 text-[11px] hover:border-[var(--wd-cyan)] hover:text-[var(--wd-cyan)] disabled:opacity-40"
            >
              + {b.label}
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  if (country && !country.isPlayer) {
    return (
      <Shell title={country.name} subtitle={country.iso3}>
        <Bar label="GDP" value={`$${country.gdp.toFixed(0)}b`} />
        <div className="mt-2 text-xs text-cyan-200/50">
          Diplomacy, trade and war options unlock in later phases. (AI-controlled nation.)
        </div>
      </Shell>
    );
  }

  return <BudgetView />;
}

function BudgetView() {
  const snapshot = useGameStore((s) => s.snapshot)!;
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [isPending, startTransition] = useTransition();
  const p = snapshot.player;
  const [levers, setLevers] = useState({
    taxRate: p.taxRate,
    militaryBudgetPct: p.militaryBudgetPct,
    welfareBudgetPct: p.welfareBudgetPct,
    infraBudgetPct: p.infraBudgetPct,
    researchBudgetPct: p.researchBudgetPct,
  });

  useEffect(() => {
    setLevers({
      taxRate: p.taxRate,
      militaryBudgetPct: p.militaryBudgetPct,
      welfareBudgetPct: p.welfareBudgetPct,
      infraBudgetPct: p.infraBudgetPct,
      researchBudgetPct: p.researchBudgetPct,
    });
  }, [p.taxRate, p.militaryBudgetPct, p.welfareBudgetPct, p.infraBudgetPct, p.researchBudgetPct]);

  const apply = () =>
    startTransition(async () => {
      const next = await setBudget(snapshot.gameId, levers);
      if (next) setSnapshot(next);
    });

  const slider = (key: keyof typeof levers, label: string) => (
    <label className="block text-xs">
      <div className="flex justify-between text-cyan-200/70">
        <span>{label}</span>
        <span className="neon-text text-[var(--wd-cyan)]">{levers[key].toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={key === "taxRate" ? 60 : 100}
        value={levers[key]}
        onChange={(e) => setLevers({ ...levers, [key]: Number(e.target.value) })}
        className="w-full accent-[var(--wd-cyan)]"
      />
    </label>
  );

  return (
    <Shell title="National Policy" subtitle={p.name}>
      {slider("taxRate", "Tax Rate")}
      {slider("militaryBudgetPct", "Military")}
      {slider("welfareBudgetPct", "Welfare")}
      {slider("infraBudgetPct", "Infrastructure")}
      {slider("researchBudgetPct", "Research")}
      <button
        onClick={apply}
        disabled={isPending}
        className="mt-2 w-full rounded border border-[var(--wd-cyan)] py-1.5 text-xs text-[var(--wd-cyan)] hover:bg-[var(--wd-cyan)]/10 disabled:opacity-40"
      >
        {isPending ? "Applying…" : "Apply Policy"}
      </button>
      <div className="mt-3 text-[10px] text-cyan-200/40">
        Click a magenta territory marker to manage construction, or a cyan nation to inspect it.
      </div>
    </Shell>
  );
}

function Shell({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="panel glow-border flex h-full flex-col gap-2 overflow-y-auto scroll-thin p-3">
      {title && (
        <div className="border-b border-[var(--wd-border)] pb-1">
          <div className="neon-text text-sm font-bold text-[var(--wd-cyan)]">{title}</div>
          {subtitle && <div className="text-[10px] uppercase tracking-widest text-cyan-200/40">{subtitle}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function Bar({ label, value, pct, danger }: { label: string; value: string; pct?: number; danger?: boolean }) {
  return (
    <div className="text-xs">
      <div className="flex justify-between text-cyan-200/70">
        <span>{label}</span>
        <span className="neon-text text-cyan-200">{value}</span>
      </div>
      {pct !== undefined && (
        <div className="mt-0.5 h-1 w-full rounded bg-[var(--wd-border)]">
          <div
            className="h-full rounded"
            style={{ width: `${Math.min(100, pct)}%`, background: danger ? "var(--wd-red)" : "var(--wd-cyan)" }}
          />
        </div>
      )}
    </div>
  );
}
