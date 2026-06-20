"use client";

import { useEffect, useState, useTransition } from "react";
import { useGameStore } from "@/store/game";
import {
  setBudget,
  queueBuilding,
  recruitUnit,
  moveArmy,
  declareWar,
  proposePeace,
  improveRelations,
  toggleEmbargo,
  createTradeRoute,
  cancelTradeRoute,
  startResearch,
} from "@/app/actions";
import type { WorldSnapshot } from "@/lib/snapshot";
import type { BuildingType, UnitType, TradeGood } from "@prisma/client";

type Tab = "policy" | "military" | "diplomacy" | "trade" | "research";

// Shared hook: run a server action that returns a fresh snapshot, then store it.
function useAction() {
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<WorldSnapshot | null>) =>
    startTransition(async () => {
      const next = await fn();
      if (next) setSnapshot(next);
    });
  return { run, isPending };
}

export default function InfoPanel() {
  const snapshot = useGameStore((s) => s.snapshot);
  const selectedTerritoryId = useGameStore((s) => s.selectedTerritoryId);
  const selectedCountryIso = useGameStore((s) => s.selectedCountryIso);
  const [tab, setTab] = useState<Tab>("policy");

  if (!snapshot) return <Shell>Loading command center…</Shell>;

  const territory = snapshot.territories.find((t) => t.id === selectedTerritoryId);
  if (territory) return <TerritoryPanel snapshot={snapshot} territory={territory} />;

  const country = snapshot.countries.find((c) => c.iso3 === selectedCountryIso);
  if (country && !country.isPlayer) return <CountryPanel snapshot={snapshot} iso={country.iso3} name={country.name} />;

  return (
    <Shell title="Command Center" subtitle={snapshot.player.name}>
      <div className="flex flex-wrap gap-1">
        {(["policy", "military", "diplomacy", "trade", "research"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-2 py-0.5 text-[10px] uppercase ${
              tab === t ? "bg-[var(--wd-cyan)]/20 text-[var(--wd-cyan)]" : "text-cyan-200/50"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-1">
        {tab === "policy" && <PolicyTab snapshot={snapshot} />}
        {tab === "military" && <MilitaryTab snapshot={snapshot} />}
        {tab === "diplomacy" && <DiplomacyTab snapshot={snapshot} />}
        {tab === "trade" && <TradeTab snapshot={snapshot} />}
        {tab === "research" && <ResearchTab snapshot={snapshot} />}
      </div>
    </Shell>
  );
}

// ── POLICY ───────────────────────────────────────────────────────────────────
function PolicyTab({ snapshot }: { snapshot: WorldSnapshot }) {
  const { run, isPending } = useAction();
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

  const r = snapshot.rankings;
  return (
    <div className="space-y-1">
      <div className="mb-1 grid grid-cols-3 gap-1 text-center text-[10px]">
        <Rank label="GDP" rank={r.gdp} total={r.total} />
        <Rank label="Influence" rank={r.influence} total={r.total} />
        <Rank label="Territory" rank={r.territory} total={r.total} />
      </div>
      {slider("taxRate", "Tax Rate")}
      {slider("militaryBudgetPct", "Military")}
      {slider("welfareBudgetPct", "Welfare")}
      {slider("infraBudgetPct", "Infrastructure")}
      {slider("researchBudgetPct", "Research")}
      <Btn disabled={isPending} onClick={() => run(() => setBudget(snapshot.gameId, levers))}>
        {isPending ? "Applying…" : "Apply Policy"}
      </Btn>
      <p className="text-[10px] text-cyan-200/40">High tax erodes morale; military upkeep grows super-linearly.</p>
    </div>
  );
}

// ── MILITARY ───────────────────────────────────────────────────────────────
const RECRUITABLE: { type: UnitType; label: string }[] = [
  { type: "INFANTRY", label: "Infantry" },
  { type: "MECHANIZED", label: "Mech" },
  { type: "TANK", label: "Tank" },
  { type: "ARTILLERY", label: "Artillery" },
];

function MilitaryTab({ snapshot }: { snapshot: WorldSnapshot }) {
  const { run, isPending } = useAction();
  const strongest = [...snapshot.armies].sort((a, b) => b.strength - a.strength)[0];

  return (
    <div className="space-y-2">
      <Section label="Recruit (into 1st Army)">
        <div className="grid grid-cols-2 gap-1">
          {RECRUITABLE.map((u) => (
            <Btn key={u.type} small disabled={isPending} onClick={() => run(() => recruitUnit(snapshot.gameId, u.type, 1))}>
              + {u.label}
            </Btn>
          ))}
        </div>
      </Section>

      <Section label="Armies">
        {snapshot.armies.length === 0 && <Empty>No standing army.</Empty>}
        {snapshot.armies.map((a) => (
          <div key={a.id} className="rounded border border-[var(--wd-border)] p-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[var(--wd-cyan)]">{a.name}</span>
              <span className="text-cyan-200/50">{a.state}</span>
            </div>
            <div className="text-cyan-200/70">
              Strength {a.strength.toFixed(0)} · {a.units.map((u) => `${u.count} ${u.type.toLowerCase()}`).join(", ") || "empty"}
            </div>
          </div>
        ))}
      </Section>

      {snapshot.warTargets.length > 0 && (
        <Section label="Offensives">
          {snapshot.warTargets.map((w) => (
            <Btn
              key={w.territoryId}
              small
              disabled={isPending || !strongest}
              onClick={() => strongest && run(() => moveArmy(snapshot.gameId, strongest.id, w.territoryId))}
            >
              March on {w.territoryName} ({w.enemyIso})
            </Btn>
          ))}
        </Section>
      )}
    </div>
  );
}

// ── DIPLOMACY ─────────────────────────────────────────────────────────────
function DiplomacyTab({ snapshot }: { snapshot: WorldSnapshot }) {
  const { run, isPending } = useAction();
  const relByIso = new Map(snapshot.relations.map((r) => [r.iso3, r]));
  const others = snapshot.countries
    .filter((c) => !c.isPlayer && c.isAlive)
    .sort((a, b) => (relByIso.get(b.iso3)?.opinion ?? 0) - (relByIso.get(a.iso3)?.opinion ?? 0));

  return (
    <div className="space-y-2">
      {snapshot.wars.length > 0 && (
        <Section label="Active Wars">
          {snapshot.wars.map((w) => (
            <div key={w.id} className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--wd-red)]">{w.name}</span>
              <Btn small disabled={isPending} onClick={() => run(() => proposePeace(snapshot.gameId, w.id))}>
                Sue for Peace
              </Btn>
            </div>
          ))}
        </Section>
      )}
      <Section label="Nations">
        <div className="max-h-56 space-y-1 overflow-y-auto scroll-thin">
          {others.map((c) => {
            const rel = relByIso.get(c.iso3);
            const op = rel?.opinion ?? 0;
            return (
              <div key={c.iso3} className="rounded border border-[var(--wd-border)] p-1 text-[11px]">
                <div className="flex justify-between">
                  <span>{c.name}</span>
                  <span style={{ color: op >= 0 ? "var(--wd-green)" : "var(--wd-red)" }}>{op.toFixed(0)}</span>
                </div>
                <div className="mt-0.5 flex gap-1">
                  <Btn small disabled={isPending} onClick={() => run(() => improveRelations(snapshot.gameId, c.iso3))}>
                    Improve
                  </Btn>
                  <Btn
                    small
                    disabled={isPending}
                    onClick={() => run(() => toggleEmbargo(snapshot.gameId, c.iso3, !rel?.embargo))}
                  >
                    {rel?.embargo ? "Lift Embargo" : "Embargo"}
                  </Btn>
                  {rel?.atWar ? (
                    <span className="text-[var(--wd-red)]">AT WAR</span>
                  ) : (
                    <Btn small danger disabled={isPending} onClick={() => run(() => declareWar(snapshot.gameId, c.iso3))}>
                      Declare War
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// ── TRADE ────────────────────────────────────────────────────────────────────
const GOODS: TradeGood[] = ["OIL", "FOOD", "STEEL", "RARE_MATERIALS"];

function TradeTab({ snapshot }: { snapshot: WorldSnapshot }) {
  const { run, isPending } = useAction();
  const others = snapshot.countries.filter((c) => !c.isPlayer && c.isAlive);
  const [iso, setIso] = useState(others[0]?.iso3 ?? "");
  const [good, setGood] = useState<TradeGood>("OIL");
  const [rate, setRate] = useState(10);
  const [dir, setDir] = useState<"IMPORT" | "EXPORT">("IMPORT");

  return (
    <div className="space-y-2">
      <Section label="New Route">
        <div className="space-y-1 text-[11px]">
          <select value={dir} onChange={(e) => setDir(e.target.value as "IMPORT" | "EXPORT")} className="w-full bg-[var(--wd-panel)] p-1">
            <option value="IMPORT">Import (buy)</option>
            <option value="EXPORT">Export (sell)</option>
          </select>
          <select value={iso} onChange={(e) => setIso(e.target.value)} className="w-full bg-[var(--wd-panel)] p-1">
            {others.map((c) => (
              <option key={c.iso3} value={c.iso3}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <select value={good} onChange={(e) => setGood(e.target.value as TradeGood)} className="flex-1 bg-[var(--wd-panel)] p-1">
              {GOODS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={rate}
              min={1}
              onChange={(e) => setRate(Number(e.target.value))}
              className="w-16 bg-[var(--wd-panel)] p-1"
            />
          </div>
          <Btn small disabled={isPending || !iso} onClick={() => run(() => createTradeRoute(snapshot.gameId, iso, good, rate, dir))}>
            Establish Route
          </Btn>
        </div>
      </Section>
      <Section label="Routes">
        {snapshot.tradeRoutes.length === 0 && <Empty>No trade routes.</Empty>}
        {snapshot.tradeRoutes.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-[11px]">
            <span>
              {r.fromIso}→{r.toIso} {r.good} {r.ratePerDay}/d {r.blockaded && <span className="text-[var(--wd-red)]">⚠</span>}
            </span>
            <Btn small disabled={isPending} onClick={() => run(() => cancelTradeRoute(snapshot.gameId, r.id))}>
              ✕
            </Btn>
          </div>
        ))}
      </Section>
    </div>
  );
}

// ── RESEARCH ──────────────────────────────────────────────────────────────
function ResearchTab({ snapshot }: { snapshot: WorldSnapshot }) {
  const { run, isPending } = useAction();
  const completedKeys = new Set(snapshot.research.filter((r) => r.completed).map((r) => r.techKey));

  return (
    <div className="space-y-2">
      <Section label="In Progress">
        {snapshot.research.filter((r) => !r.completed).length === 0 && <Empty>Nothing researching.</Empty>}
        {snapshot.research
          .filter((r) => !r.completed)
          .map((r) => (
            <div key={r.techKey} className="text-[11px]">
              <div className="flex justify-between">
                <span>{r.name}</span>
                <span className="text-cyan-200/50">{r.progress.toFixed(0)}%</span>
              </div>
              <div className="h-1 w-full rounded bg-[var(--wd-border)]">
                <div className="h-full rounded bg-[var(--wd-cyan)]" style={{ width: `${r.progress}%` }} />
              </div>
            </div>
          ))}
      </Section>
      <Section label="Available">
        {snapshot.availableTech.map((t) => {
          const locked = t.requires.some((req) => !completedKeys.has(req));
          return (
            <div key={t.key} className="flex items-center justify-between text-[11px]">
              <span className={locked ? "text-cyan-200/30" : ""}>
                {t.name} <span className="text-cyan-200/40">({t.category.toLowerCase()}, {t.days}d)</span>
              </span>
              <Btn small disabled={isPending || locked} onClick={() => run(() => startResearch(snapshot.gameId, t.key))}>
                {locked ? "Locked" : "Research"}
              </Btn>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

// ── TERRITORY / COUNTRY PANELS ─────────────────────────────────────────────
const BUILD_OPTIONS: { type: BuildingType; label: string }[] = [
  { type: "HOUSING", label: "Housing" },
  { type: "FARM", label: "Farm" },
  { type: "FACTORY", label: "Factory" },
  { type: "POWER_PLANT", label: "Power" },
  { type: "BARRACKS", label: "Barracks" },
  { type: "AIR_BASE", label: "Air Base" },
];

function TerritoryPanel({ snapshot, territory }: { snapshot: WorldSnapshot; territory: WorldSnapshot["territories"][number] }) {
  const { run, isPending } = useAction();
  return (
    <Shell title={territory.name} subtitle={territory.kind}>
      <Bar label="Population" value={`${territory.population.toFixed(1)}M`} />
      <Bar label="Morale" value={territory.morale.toFixed(0)} pct={territory.morale} />
      <Bar label="Unrest" value={territory.unrest.toFixed(0)} pct={territory.unrest} danger />
      <Bar label="Control" value={`${territory.controlPct.toFixed(0)}%`} pct={territory.controlPct} />
      {territory.occupied && <div className="text-xs text-[var(--wd-red)]">⚠ Under occupation</div>}

      <Section label="Construction">
        <div className="grid grid-cols-2 gap-1">
          {BUILD_OPTIONS.map((b) => (
            <Btn key={b.type} small disabled={isPending} onClick={() => run(() => queueBuilding(snapshot.gameId, territory.id, b.type))}>
              + {b.label}
            </Btn>
          ))}
        </div>
      </Section>

      {snapshot.armies.length > 0 && (
        <Section label="Reposition Army">
          {snapshot.armies.map((a) => (
            <Btn key={a.id} small disabled={isPending} onClick={() => run(() => moveArmy(snapshot.gameId, a.id, territory.id))}>
              Move {a.name} here
            </Btn>
          ))}
        </Section>
      )}
    </Shell>
  );
}

function CountryPanel({ snapshot, iso, name }: { snapshot: WorldSnapshot; iso: string; name: string }) {
  const { run, isPending } = useAction();
  const rel = snapshot.relations.find((r) => r.iso3 === iso);
  const dot = snapshot.countries.find((c) => c.iso3 === iso);
  return (
    <Shell title={name} subtitle={iso}>
      <Bar label="GDP" value={`$${(dot?.gdp ?? 0).toFixed(0)}b`} />
      <Bar label="Opinion" value={(rel?.opinion ?? 0).toFixed(0)} />
      <div className="mt-2 flex flex-col gap-1">
        <Btn small disabled={isPending} onClick={() => run(() => improveRelations(snapshot.gameId, iso))}>
          Improve Relations
        </Btn>
        <Btn small disabled={isPending} onClick={() => run(() => toggleEmbargo(snapshot.gameId, iso, !rel?.embargo))}>
          {rel?.embargo ? "Lift Embargo" : "Impose Embargo"}
        </Btn>
        {rel?.atWar ? (
          <span className="text-xs text-[var(--wd-red)]">⚔ Currently at war</span>
        ) : (
          <Btn small danger disabled={isPending} onClick={() => run(() => declareWar(snapshot.gameId, iso))}>
            Declare War
          </Btn>
        )}
      </div>
    </Shell>
  );
}

// ── PRIMITIVES ───────────────────────────────────────────────────────────────
function Shell({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  const select = useGameStore((s) => s.selectTerritory);
  const selectC = useGameStore((s) => s.selectCountry);
  const hasSelection = useGameStore((s) => s.selectedTerritoryId || s.selectedCountryIso);
  return (
    <div className="panel glow-border flex h-full flex-col gap-2 overflow-y-auto scroll-thin p-3">
      {title && (
        <div className="flex items-start justify-between border-b border-[var(--wd-border)] pb-1">
          <div>
            <div className="neon-text text-sm font-bold text-[var(--wd-cyan)]">{title}</div>
            {subtitle && <div className="text-[10px] uppercase tracking-widest text-cyan-200/40">{subtitle}</div>}
          </div>
          {hasSelection && (
            <button
              onClick={() => {
                select(null);
                selectC(null);
              }}
              className="text-[10px] text-cyan-200/50 hover:text-[var(--wd-cyan)]"
            >
              ✕ close
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-cyan-200/50">{label}</div>
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  small,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
  danger?: boolean;
}) {
  const color = danger ? "var(--wd-red)" : "var(--wd-cyan)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2 ${small ? "py-0.5 text-[10px]" : "w-full py-1.5 text-xs"} disabled:opacity-40`}
      style={{ borderColor: `${color}55`, color }}
    >
      {children}
    </button>
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
          <div className="h-full rounded" style={{ width: `${Math.min(100, pct)}%`, background: danger ? "var(--wd-red)" : "var(--wd-cyan)" }} />
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-cyan-200/30">{children}</div>;
}

function Rank({ label, rank, total }: { label: string; rank: number; total: number }) {
  return (
    <div className="rounded border border-[var(--wd-border)] py-1">
      <div className="uppercase tracking-widest text-cyan-200/40">{label}</div>
      <div className="neon-text text-[var(--wd-cyan)]">
        #{rank}
        <span className="text-cyan-200/40">/{total}</span>
      </div>
    </div>
  );
}
