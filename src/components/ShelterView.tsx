"use client";

import { useState } from "react";
import { useGame } from "@/store/game";
import { Btn, Meter, ResourceChip, useAction } from "@/components/ui";
import { startExpedition, equipItem, unequipItem, useConsumable, craft, upgrade } from "@/app/actions";
import type { ItemView } from "@/lib/types";

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
      {/* Header: identity + vitals */}
      <div className="panel rounded p-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="title stamp text-lg font-bold text-[var(--rust)]">{player.name}</div>
            <div className="text-[10px] text-[var(--ink-dim)]">
              Lv {player.level} · {player.xp}/{player.xpToNext} XP · Shelter L{shelter.level} · Rep {player.reputation}
            </div>
          </div>
          <div className="title text-[10px] text-[var(--tox)]">◢ SHELTER ◣</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Meter label="Health" value={player.health} max={player.maxHealth} color="#b13838" />
          <Meter label="Stamina" value={player.stamina} max={100} color="#e0a32e" />
          <Meter label="Radiation" value={player.radiation} max={100} color="#8fbf3f" />
        </div>
      </div>

      {/* Resources */}
      <div className="panel rounded p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["food", "water", "meds", "ammo", "scrap", "fuel"] as const).map((k) => (
            <ResourceChip key={k} k={k} value={shelter[k]} />
          ))}
          <div className="ml-auto text-[10px] text-[var(--ink-dim)]">
            Morale {Math.round(shelter.morale)} · Storage {shelter.storedCount}/{shelter.storageCap}
          </div>
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
            <UpgradeRow label={`Storage (+60 cap)`} onClick={() => run(() => upgrade(player.id, "storage"))} busy={isPending} note={`cap ${shelter.storageCap}`} />
            <UpgradeRow label={`Shelter level`} onClick={() => run(() => upgrade(player.id, "shelter"))} busy={isPending} note={`L${shelter.level}`} />
            <UpgradeRow label={`Workshop`} onClick={() => run(() => upgrade(player.id, "workshop"))} busy={isPending} note={`L${shelter.workshopLvl}`} />
            <UpgradeRow label={`Medical Station`} onClick={() => run(() => upgrade(player.id, "medical"))} busy={isPending} note={`L${shelter.medicalLvl}`} />
            <UpgradeRow label={`Ammo Bench`} onClick={() => run(() => upgrade(player.id, "ammoBench"))} busy={isPending} note={`L${shelter.ammoBenchLvl}`} />
            <UpgradeRow label={`Weapon Bench`} onClick={() => run(() => upgrade(player.id, "weaponBench"))} busy={isPending} note={`L${shelter.weaponBenchLvl}`} />
            <p className="pt-1 text-[10px] text-[var(--ink-dim)]">Upgrades cost scrap &amp; fuel, scaling with level.</p>
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

function UpgradeRow({ label, note, onClick, busy }: { label: string; note: string; onClick: () => void; busy: boolean }) {
  return (
    <div className="inset flex items-center justify-between rounded px-2 py-1.5">
      <div>
        <div>{label}</div>
        <div className="text-[10px] text-[var(--ink-dim)]">current {note}</div>
      </div>
      <Btn disabled={busy} onClick={onClick}>Upgrade</Btn>
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
