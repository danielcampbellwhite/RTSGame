"use client";

import { useState } from "react";
import { useGame } from "@/store/game";
import { Btn, Meter, useAction } from "@/components/ui";
import { startExpedition, equipItem, unequipItem, useConsumable, craft, upgrade } from "@/app/actions";
import { stationLevelReq } from "@/data/recipes";
import type { ItemView } from "@/lib/types";

const RES: { k: "food" | "water" | "meds" | "ammo" | "scrap" | "fuel"; name: string; icon: string }[] = [
  { k: "food", name: "Food", icon: "🥫" },
  { k: "water", name: "Water", icon: "🚰" },
  { k: "meds", name: "Meds", icon: "💊" },
  { k: "ammo", name: "Ammo", icon: "🧨" },
  { k: "scrap", name: "Scrap", icon: "🔩" },
  { k: "fuel", name: "Fuel", icon: "⛽" },
];

type Tab = "loadout" | "craft" | "build";

const SLOTS: { key: string; label: string }[] = [
  { key: "PRIMARY", label: "Primary" },
  { key: "SECONDARY", label: "Sidearm" },
  { key: "ARMOR", label: "Armor" },
  { key: "HELMET", label: "Helmet" },
  { key: "BACKPACK", label: "Pack" },
];

export default function ShelterView() {
  const snap = useGame((s) => s.snapshot)!;
  const { run, isPending } = useAction();
  const [tab, setTab] = useState<Tab>("loadout");
  const { player, shelter, storage, equipped, craftables } = snap;

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-2">
      {/* Header banner: the shelter interior, with identity + vitals overlaid */}
      <div
        className="panel relative overflow-hidden rounded"
        style={{
          backgroundImage: "linear-gradient(180deg, rgba(12,10,8,0.25) 0%, rgba(12,10,8,0.55) 45%, rgba(12,10,8,0.94) 100%), url('/shelter.png')",
          backgroundSize: "cover",
          backgroundPosition: "center 32%",
        }}
      >
        <div className="p-3 pt-20">
          <div className="flex items-end justify-between">
            <div>
              <div className="title stamp text-xl font-bold text-[#ffd9a8]">{player.name}</div>
              <div className="text-[10px] text-[var(--ink)]">
                Lv {player.level} · {player.xp}/{player.xpToNext} XP · Shelter L{shelter.level} · 👥 {shelter.population}/{shelter.popCap} · Rep {player.reputation}
              </div>
            </div>
            <div className="title text-[10px] text-[var(--tox)] stamp">◢ SHELTER ◣</div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Meter label="Health" value={player.health} max={player.maxHealth} color="#b13838" />
            <Meter label="Stamina" value={player.stamina} max={100} color="#e0a32e" />
            <Meter label="Radiation" value={player.radiation} max={100} color="#8fbf3f" />
          </div>
        </div>
      </div>

      {/* Shelter stores — clearly labelled; these are the PERMANENT stockpile
          (not carried gear) and slowly deplete over time. */}
      <div className="panel rounded p-2">
        <div className="title mb-1 flex items-center justify-between text-[9px] text-[var(--ink-dim)]">
          <span>Shelter Stores · deplete over time</span>
          <span>Morale {Math.round(shelter.morale)} · Storage {shelter.storedCount}/{shelter.storageCap}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {RES.map(({ k, name, icon }) => {
            const v = shelter[k];
            const low = v < 15;
            return (
              <div key={k} className="inset flex items-center gap-1.5 rounded px-2 py-1">
                <span className="text-base">{icon}</span>
                <div className="leading-tight">
                  <div className="title text-[9px] text-[var(--ink-dim)]">{name}</div>
                  <div className="text-sm" style={{ color: low ? "var(--blood)" : "var(--ink)" }}>{Math.round(v)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {snap.flash && (
        <div className="inset rounded px-3 py-2 text-xs text-[var(--amber)]">{snap.flash}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1">
        {(["loadout", "craft", "build"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`btn flex-1 rounded py-2 text-[11px] ${tab === t ? "border-[var(--rust)] text-[#ffd9a8]" : ""}`}
          >
            {t === "loadout" ? "Loadout" : t === "craft" ? "Workbench" : "Build"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        {tab === "loadout" && (
          <Loadout
            equipped={equipped}
            storage={storage}
            onEquip={(id) => run(() => equipItem(player.id, id))}
            onUnequip={(id) => run(() => unequipItem(player.id, id))}
            onUse={(id) => run(() => useConsumable(player.id, id))}
            busy={isPending}
          />
        )}
        {tab === "craft" && (
          <div className="space-y-1">
            {craftables.map((c) => (
              <div key={c.key} className="inset flex items-center justify-between rounded px-2 py-1.5">
                <div className="min-w-0">
                  <div className="text-xs">{c.name}</div>
                  <div className="text-[10px] text-[var(--ink-dim)]">{c.station} · {c.detail}</div>
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
            <UpgradeRow label="Storage (+60 cap)" onClick={() => run(() => upgrade(player.id, "storage"))} busy={isPending} note={`cap ${shelter.storageCap}`} />
            <UpgradeRow label="Beds (+2 population)" onClick={() => run(() => upgrade(player.id, "beds"))} busy={isPending} note={`pop ${shelter.population}/${shelter.popCap}`} />
            <UpgradeRow label="Shelter level" onClick={() => run(() => upgrade(player.id, "shelter"))} busy={isPending} note={`L${shelter.level}`} />
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
                />
              );
            })}
            <p className="pt-1 text-[10px] text-[var(--ink-dim)]">
              Crafting stations unlock with your survivor rank, then cost scrap &amp; fuel to build/upgrade.
            </p>
          </div>
        )}
      </div>

      {/* Embark */}
      <Btn variant="go" disabled={isPending} onClick={() => run(() => startExpedition(player.id))} className="w-full py-3 text-sm">
        ☢ Enter the Wasteland
      </Btn>
      <SaveCode id={player.id} />
    </div>
  );
}

function Loadout({
  equipped, storage, onEquip, onUnequip, onUse, busy,
}: {
  equipped: Record<string, ItemView | null>;
  storage: ItemView[];
  onEquip: (id: string) => void;
  onUnequip: (id: string) => void;
  onUse: (id: string) => void;
  busy: boolean;
}) {
  const gear = storage.filter((i) => i.slot);
  const consumables = storage.filter((i) => i.category === "CONSUMABLE");
  const other = storage.filter((i) => !i.slot && i.category !== "CONSUMABLE");

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
              <span className="title text-[8px] text-[var(--ink-dim)]">{s.label}</span>
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
          <div className="text-[9px] text-[var(--ink-dim)]">
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
      <div className="title mb-1 text-[10px] text-[var(--ink-dim)]">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-1 py-2 text-[10px] text-[var(--ink-dim)]">{children}</div>;
}

function UpgradeRow({ label, note, onClick, busy, locked }: { label: string; note: string; onClick: () => void; busy: boolean; locked?: boolean }) {
  return (
    <div className="inset flex items-center justify-between rounded px-2 py-1.5">
      <div>
        <div>{label}</div>
        <div className="text-[10px]" style={{ color: locked ? "var(--blood)" : "var(--ink-dim)" }}>{note}</div>
      </div>
      <Btn disabled={busy || locked} onClick={onClick}>{locked ? "Locked" : "Upgrade"}</Btn>
    </div>
  );
}

function SaveCode({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-center text-[9px] text-[var(--ink-dim)] hover:text-[var(--ink)]"
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
