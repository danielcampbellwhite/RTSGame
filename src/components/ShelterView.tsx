"use client";

import { useState } from "react";
import { useGame } from "@/store/game";
import { Btn, Meter, useAction } from "@/components/ui";
import { startExpedition, equipItem, unequipItem, useConsumable, craft, upgrade, assignWork, repairItem } from "@/app/actions";
import { stationLevelReq, upgradeCost } from "@/data/recipes";
import { SURV } from "@/lib/game";
import type { ItemView, ShelterView as ShelterViewT } from "@/lib/types";

const RES: { k: "food" | "water" | "meds" | "ammo" | "scrap" | "fuel"; name: string; icon: string }[] = [
  { k: "food", name: "Food", icon: "🥫" },
  { k: "water", name: "Water", icon: "🚰" },
  { k: "meds", name: "Meds", icon: "💊" },
  { k: "ammo", name: "Ammo", icon: "🧨" },
  { k: "scrap", name: "Scrap", icon: "🔩" },
  { k: "fuel", name: "Fuel", icon: "⛽" },
];

type Tab = "loadout" | "crew" | "craft" | "build" | "factions";

const SLOTS: { key: string; label: string }[] = [
  { key: "PRIMARY", label: "Primary" },
  { key: "SECONDARY", label: "Sidearm" },
  { key: "ARMOR", label: "Armor" },
  { key: "HELMET", label: "Helmet" },
  { key: "BACKPACK", label: "Pack" },
];

/** Net change per real hour for a shelter resource (worker output − use). */
function storeRate(s: ShelterViewT, k: string): number {
  switch (k) {
    case "food": return s.workFood * SURV.jobs.food - s.population * SURV.consume.food;
    case "water": return s.workWater * SURV.jobs.water - s.population * SURV.consume.water;
    case "meds": return s.workMeds * SURV.jobs.meds;
    case "scrap": return s.workScrap * SURV.jobs.scrap;
    case "fuel": return -SURV.fuelPerHour;
    default: return 0;
  }
}
function fmtRate(r: number): string {
  return (Math.round(r * 10) / 10).toString();
}

export default function ShelterView() {
  const snap = useGame((s) => s.snapshot)!;
  const { run, isPending } = useAction();
  const [tab, setTab] = useState<Tab>("loadout");
  const { player, shelter, storage, equipped, craftables, factions } = snap;

  return (
    <div className="h-full w-full space-y-2 overflow-y-auto scroll-thin p-2">
      {/* Header banner: the shelter interior, with identity + vitals overlaid.
          Fixed height + shrink-0 so the scrollable column can't squash it. */}
      <div
        className="panel relative flex shrink-0 flex-col justify-end overflow-hidden rounded"
        style={{
          backgroundImage: "linear-gradient(180deg, rgba(12,10,8,0.15) 0%, rgba(12,10,8,0.5) 45%, rgba(12,10,8,0.94) 100%), url('/shelter.png')",
          backgroundSize: "cover",
          backgroundPosition: "center 35%",
          height: "min(52vw, 240px)",
        }}
      >
        <div className="p-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="title stamp text-xl font-bold text-[#ffd9a8]">{player.name}</div>
              <div className="text-[0.66rem] text-[var(--ink)]">
                Lv {player.level} · {player.xp}/{player.xpToNext} XP · Shelter L{shelter.level} · 👥 {shelter.population}/{shelter.popCap} · Rep {player.reputation}
              </div>
            </div>
            <div className="title text-[0.66rem] text-[var(--tox)] stamp">◢ SHELTER ◣</div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Meter label="Health" value={player.health} max={player.maxHealth} color="#b13838" critical={player.health <= player.maxHealth * 0.3} />
            <Meter label="Stamina" value={player.stamina} max={100} color="#e0a32e" />
            <Meter label="Radiation" value={player.radiation} max={100} color="#8fbf3f" critical={player.radiation >= 60} />
          </div>
        </div>
      </div>

      {/* Shelter stores — clearly labelled; these are the PERMANENT stockpile
          (not carried gear) and slowly deplete over time. */}
      <div className="panel rounded p-2">
        <div className="title mb-1 flex items-center justify-between text-[0.58rem] text-[var(--ink-dim)]">
          <span>Shelter Stores · deplete over time</span>
          <span>Morale {Math.round(shelter.morale)} · Storage {shelter.storedCount}/{shelter.storageCap}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {RES.map(({ k, name, icon }) => {
            const v = shelter[k];
            const low = v < 15;
            const r = storeRate(shelter, k);
            return (
              <div key={k} className="inset flex items-center gap-1.5 rounded px-2 py-1">
                <span className="text-base">{icon}</span>
                <div className="leading-tight">
                  <div className="title text-[0.58rem] text-[var(--ink-dim)]">{name}</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm" style={{ color: low ? "var(--blood)" : "var(--ink)" }}>{Math.round(v)}</span>
                    {r !== 0 && (
                      <span className="text-[0.52rem]" style={{ color: r > 0 ? "var(--good)" : "var(--blood)" }}>
                        {r > 0 ? "+" : ""}{fmtRate(r)}/h
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {(shelter.food <= 0 || shelter.water <= 0) && (
          <div className="mt-1 text-center text-[0.66rem] text-[var(--blood)] pulse">
            ⚠ {shelter.food <= 0 && shelter.water <= 0 ? "Out of food & water" : shelter.food <= 0 ? "Out of food" : "Out of water"} — morale is collapsing. Scavenge or assign crew.
          </div>
        )}
      </div>

      {snap.flash && (
        <div className="inset rounded px-3 py-2 text-xs text-[var(--amber)]">{snap.flash}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1">
        {(["loadout", "crew", "craft", "build", "factions"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`btn flex-1 rounded py-2 text-[0.66rem] ${tab === t ? "border-[var(--rust)] text-[#ffd9a8]" : ""}`}
          >
            {t === "loadout" ? "Loadout" : t === "crew" ? "Crew" : t === "craft" ? "Craft" : t === "build" ? "Build" : "Factions"}
          </button>
        ))}
      </div>

      <div>
        {tab === "loadout" && (
          <Loadout
            equipped={equipped}
            storage={storage}
            onEquip={(id) => run(() => equipItem(player.id, id))}
            onUnequip={(id) => run(() => unequipItem(player.id, id))}
            onUse={(id) => run(() => useConsumable(player.id, id))}
            onRepair={(id) => run(() => repairItem(player.id, id))}
            busy={isPending}
          />
        )}
        {tab === "crew" && (
          <Crew shelter={shelter} onAssign={(job, d) => run(() => assignWork(player.id, job, d))} busy={isPending} />
        )}
        {tab === "factions" && (
          <div className="space-y-2">
            <p className="text-[0.66rem] text-[var(--ink-dim)]">
              Your standing across the wasteland's powers. Help their people to gain favour; kill their fighters and they&apos;ll hunt you.
            </p>
            {factions.map((f) => {
              const pct = ((f.rep + 100) / 200) * 100;
              const col = f.rep >= 25 ? "var(--good)" : f.rep > -25 ? "var(--amber)" : "var(--blood)";
              return (
                <div key={f.key} className="inset rounded p-2">
                  <div className="flex items-center justify-between text-xs">
                    <span style={{ color: f.color }}>{f.icon} {f.name}</span>
                    <span style={{ color: col }}>{f.standing} ({f.rep > 0 ? "+" : ""}{f.rep})</span>
                  </div>
                  <div className="meter mt-1"><i style={{ width: `${pct}%`, background: col }} /></div>
                  <div className="mt-1 text-[0.58rem] text-[var(--ink-dim)]">{f.note}</div>
                </div>
              );
            })}
          </div>
        )}
        {tab === "craft" && (
          <div className="space-y-1">
            {craftables.map((c) => (
              <div key={c.key} className="inset flex items-center justify-between rounded px-2 py-1.5">
                <div className="min-w-0">
                  <div className="text-xs">{c.name}</div>
                  <div className="text-[0.66rem] text-[var(--ink-dim)]">{c.station} · {c.detail}</div>
                </div>
                <Btn disabled={isPending || !c.affordable} onClick={() => run(() => craft(player.id, c.key))}>
                  Craft
                </Btn>
              </div>
            ))}
          </div>
        )}
        {tab === "build" && (
          <div className="space-y-1 text-xs">
            <div className="title flex items-center justify-end gap-2 px-1 text-[0.58rem] text-[var(--ink-dim)]">
              <span>have</span>
              <span style={{ color: shelter.scrap > 0 ? "var(--ink)" : "var(--blood)" }}>🔩 {shelter.scrap}</span>
              <span style={{ color: shelter.fuel > 0 ? "var(--ink)" : "var(--blood)" }}>⛽ {shelter.fuel}</span>
            </div>
            <UpgradeRow label="Storage (+60 cap)" onClick={() => run(() => upgrade(player.id, "storage"))} busy={isPending} note={`cap ${shelter.storageCap}`} cost={upgradeCost(Math.floor((shelter.storageCap - 240) / 60) + 2)} have={shelter} />
            <UpgradeRow label="Beds (+2 population)" onClick={() => run(() => upgrade(player.id, "beds"))} busy={isPending} note={`pop ${shelter.population}/${shelter.popCap}`} cost={upgradeCost(Math.floor((shelter.popCap - 3) / 2) + 2)} have={shelter} />
            <UpgradeRow label="Shelter level" onClick={() => run(() => upgrade(player.id, "shelter"))} busy={isPending} note={`L${shelter.level}`} cost={upgradeCost(shelter.level + 1)} have={shelter} />
            {([
              { label: "Workshop", t: "workshop" as const, lvl: shelter.workshopLvl },
              { label: "Medical Station", t: "medical" as const, lvl: shelter.medicalLvl },
              { label: "Ammo Bench", t: "ammoBench" as const, lvl: shelter.ammoBenchLvl },
              { label: "Weapon Bench", t: "weaponBench" as const, lvl: shelter.weaponBenchLvl },
            ]).map((s) => {
              const req = stationLevelReq(s.lvl + 1);
              const locked = player.level < req;
              return (
                <UpgradeRow
                  key={s.t}
                  label={s.label}
                  onClick={() => run(() => upgrade(player.id, s.t))}
                  busy={isPending}
                  locked={locked}
                  note={locked ? `L${s.lvl} · 🔒 needs rank ${req}` : `L${s.lvl}`}
                  cost={upgradeCost(s.lvl + 1)}
                  have={shelter}
                />
              );
            })}
            <p className="pt-1 text-[0.66rem] text-[var(--ink-dim)]">
              Crafting stations unlock with your survivor rank, then cost scrap &amp; fuel to build/upgrade.
            </p>
          </div>
        )}
      </div>

      {/* Embark */}
      <Btn variant="go" disabled={isPending} onClick={() => run(() => startExpedition(player.id))} className="w-full py-3 text-sm">
        ☢ Head into the City
      </Btn>
      <SaveCode id={player.id} />
    </div>
  );
}

function Loadout({
  equipped, storage, onEquip, onUnequip, onUse, onRepair, busy,
}: {
  equipped: Record<string, ItemView | null>;
  storage: ItemView[];
  onEquip: (id: string) => void;
  onUnequip: (id: string) => void;
  onUse: (id: string) => void;
  onRepair: (id: string) => void;
  busy: boolean;
}) {
  const gear = storage.filter((i) => i.slot);
  const consumables = storage.filter((i) => i.category === "CONSUMABLE");
  const other = storage.filter((i) => !i.slot && i.category !== "CONSUMABLE");
  const damaged = [...storage, ...Object.values(equipped).filter((x): x is ItemView => !!x)].filter(
    (i) => i.durability != null && i.maxDurability != null && i.durability < i.maxDurability
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1">
        {SLOTS.map((s) => {
          const it = equipped[s.key];
          return (
            <button
              key={s.key}
              disabled={busy || !it}
              onClick={() => it && onUnequip(it.id)}
              className="inset flex aspect-square flex-col items-center justify-center rounded p-1"
              title={it ? `${it.name} (tap to unequip)` : s.label}
            >
              <span className="text-lg">{it ? it.icon : "·"}</span>
              <span className="title text-[0.5rem] text-[var(--ink-dim)]">{s.label}</span>
            </button>
          );
        })}
      </div>

      <Section title="Gear">
        {gear.length === 0 && <Empty>No spare gear stored.</Empty>}
        {gear.map((i) => (
          <ItemRow key={i.id} item={i} action="Equip" busy={busy} onAction={() => onEquip(i.id)} />
        ))}
      </Section>

      <Section title="Consumables">
        {consumables.length === 0 && <Empty>No consumables.</Empty>}
        {consumables.map((i) => (
          <ItemRow key={i.id} item={i} action="Use" busy={busy} onAction={() => onUse(i.id)} />
        ))}
      </Section>

      {damaged.length > 0 && (
        <Section title="Repairs (workshop)">
          {damaged.map((i) => (
            <ItemRow key={`rep-${i.id}`} item={i} action="Repair" busy={busy} onAction={() => onRepair(i.id)} />
          ))}
        </Section>
      )}

      {other.length > 0 && (
        <Section title="Materials">
          {other.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Crew({ shelter, onAssign, busy }: { shelter: ShelterViewT; onAssign: (job: "food" | "water" | "scrap" | "meds", d: number) => void; busy: boolean }) {
  const assigned = shelter.workFood + shelter.workWater + shelter.workScrap + shelter.workMeds;
  const idle = shelter.population - assigned;
  const jobs: { key: "food" | "water" | "scrap" | "meds"; label: string; icon: string; count: number }[] = [
    { key: "food", label: "Farming", icon: "🥫", count: shelter.workFood },
    { key: "water", label: "Water", icon: "🚰", count: shelter.workWater },
    { key: "scrap", label: "Scrapping", icon: "🔩", count: shelter.workScrap },
    { key: "meds", label: "Medicine", icon: "💊", count: shelter.workMeds },
  ];
  const netFood = (shelter.workFood * SURV.jobs.food - shelter.population * SURV.consume.food).toFixed(0);
  const netWater = (shelter.workWater * SURV.jobs.water - shelter.population * SURV.consume.water).toFixed(0);
  return (
    <div className="space-y-2">
      <div className="inset rounded p-2 text-[0.66rem] text-[var(--ink-dim)]">
        Population <span className="text-[var(--ink)]">{shelter.population}/{shelter.popCap}</span> · Idle{" "}
        <span className="text-[var(--ink)]">{idle}</span>. Each resident eats; assign survivors to gather. Net food{" "}
        <span style={{ color: +netFood < 0 ? "var(--blood)" : "var(--good)" }}>{netFood}/hr</span>, water{" "}
        <span style={{ color: +netWater < 0 ? "var(--blood)" : "var(--good)" }}>{netWater}/hr</span>.
      </div>
      {jobs.map((j) => (
        <div key={j.key} className="inset flex items-center justify-between rounded px-2 py-1.5">
          <div className="text-xs">
            {j.icon} {j.label} <span className="text-[var(--ink-dim)]">· +{SURV.jobs[j.key]}/hr each</span>
          </div>
          <div className="flex items-center gap-2">
            <Btn disabled={busy || j.count <= 0} onClick={() => onAssign(j.key, -1)}>−</Btn>
            <span className="w-4 text-center text-sm">{j.count}</span>
            <Btn disabled={busy || idle <= 0} onClick={() => onAssign(j.key, 1)}>+</Btn>
          </div>
        </div>
      ))}
      <p className="text-[0.66rem] text-[var(--ink-dim)]">Recruit survivors in the wasteland, then build Beds to house more.</p>
    </div>
  );
}

export function ItemRow({ item, action, onAction, busy }: { item: ItemView; action?: string; onAction?: () => void; busy?: boolean }) {
  return (
    <div className="inset flex items-center justify-between rounded px-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-base">{item.icon}</span>
        <div className="min-w-0">
          <div className="truncate text-xs">
            {item.name}
            {item.quantity > 1 && <span className="text-[var(--ink-dim)]"> ×{item.quantity}</span>}
          </div>
          <div className="text-[0.58rem] text-[var(--ink-dim)]">
            {item.durability != null && item.maxDurability ? `dur ${item.durability}/${item.maxDurability}` : item.category.toLowerCase()}
          </div>
        </div>
      </div>
      {action && (
        <Btn disabled={busy} onClick={onAction}>{action}</Btn>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="title mb-1 text-[0.66rem] text-[var(--ink-dim)]">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-1 py-2 text-[0.66rem] text-[var(--ink-dim)]">{children}</div>;
}

function UpgradeRow({ label, note, onClick, busy, locked, cost, have }: { label: string; note: string; onClick: () => void; busy: boolean; locked?: boolean; cost: { scrap: number; fuel: number }; have: ShelterViewT }) {
  const canScrap = have.scrap >= cost.scrap;
  const canFuel = have.fuel >= cost.fuel;
  const affordable = canScrap && canFuel;
  return (
    <div className="inset flex items-center justify-between rounded px-2 py-1.5">
      <div>
        <div>{label}</div>
        <div className="flex items-center gap-2 text-[0.66rem]">
          <span style={{ color: locked ? "var(--blood)" : "var(--ink-dim)" }}>{note}</span>
          <span className="text-[var(--ink-dim)]">·</span>
          <span style={{ color: canScrap ? "var(--ink-dim)" : "var(--blood)" }}>🔩 {cost.scrap}</span>
          <span style={{ color: canFuel ? "var(--ink-dim)" : "var(--blood)" }}>⛽ {cost.fuel}</span>
        </div>
      </div>
      <Btn disabled={busy || locked || !affordable} onClick={onClick}>{locked ? "Locked" : "Upgrade"}</Btn>
    </div>
  );
}

function SaveCode({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-center text-[0.58rem] text-[var(--ink-dim)] hover:text-[var(--ink)]"
      onClick={() => {
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy save code"
    >
      {copied ? "copied!" : `save code: ${id.slice(0, 12)}… (tap to copy)`}
    </button>
  );
}
