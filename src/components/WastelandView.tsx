"use client";

import { useGame } from "@/store/game";
import { Btn, Meter, useAction } from "@/components/ui";
import { move, resolveEncounter, returnHome, useConsumable } from "@/app/actions";

export default function WastelandView() {
  const snap = useGame((s) => s.snapshot)!;
  const { run, isPending } = useAction();
  const { player, expedition: exp } = snap;
  if (!exp) return null;

  const cols = exp.windowRadius * 2 + 1;
  const ammo = exp.backpack.filter((b) => b.defKey === "ammo").reduce((n, b) => n + b.quantity, 0);
  const consumables = exp.backpack.filter((b) => b.category === "CONSUMABLE");
  const blocked = !!exp.pending || isPending;

  return (
    <div className="grime relative flex h-full w-full flex-col gap-2 overflow-hidden p-2">
      {/* HUD */}
      <div className="panel rounded p-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="title text-[var(--rust)]">WASTELAND</span>
          <span className="text-[var(--ink-dim)]">
            {exp.currentLabel} · {exp.distance} out · Tier {exp.tier}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Meter label="Health" value={player.health} max={player.maxHealth} color="#b13838" />
          <Meter label="Stamina" value={player.stamina} max={100} color="#e0a32e" />
          <Meter label="Radiation" value={player.radiation} max={100} color="#8fbf3f" />
        </div>
      </div>

      {/* Map window */}
      <div className="panel relative flex-1 overflow-hidden rounded p-2">
        <div
          className="mx-auto grid h-full w-full max-w-[420px] gap-[2px]"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {exp.tiles.map((t) => {
            const base = t.revealed ? t.color ?? "#2a241d" : "#0e0b09";
            return (
              <div
                key={`${t.x},${t.y}`}
                title={t.revealed ? t.label : "unexplored"}
                className={`flex aspect-square items-center justify-center rounded-[2px] text-[11px] ${
                  t.isPlayer ? "ring-2 ring-[var(--amber)]" : ""
                }`}
                style={{
                  background: t.isPlayer ? "#3a2f23" : base,
                  opacity: t.revealed ? 1 : 0.5,
                  border: t.isExit ? "1px solid var(--tox)" : "1px solid rgba(0,0,0,0.3)",
                }}
              >
                {t.isPlayer ? "🧍" : t.revealed ? (t.feature === "EMPTY" ? "" : t.icon) : ""}
              </div>
            );
          })}
        </div>
      </div>

      {/* Encounter / log */}
      {exp.pending ? (
        <div className="panel rounded border-[var(--blood)] p-2" style={{ borderColor: "var(--blood)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{exp.pending.icon}</span>
              <div>
                <div className="text-sm text-[#ffb4b4]">{exp.pending.name}</div>
                <div className="text-[10px] text-[var(--ink-dim)]">power {exp.pending.power} · hp {exp.pending.hp}/{exp.pending.maxHp}</div>
              </div>
            </div>
            <div className="flex gap-1">
              <Btn variant="danger" disabled={isPending} onClick={() => run(() => resolveEncounter(player.id, "fight"))}>Fight</Btn>
              <Btn disabled={isPending} onClick={() => run(() => resolveEncounter(player.id, "flee"))}>Flee</Btn>
            </div>
          </div>
        </div>
      ) : (
        <div className="inset h-14 overflow-y-auto scroll-thin rounded px-2 py-1 text-[10px] leading-snug text-[var(--ink-dim)]">
          {exp.log.map((l, i) => (
            <div key={i} className={i === 0 ? "text-[var(--ink)]" : ""}>{l}</div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-stretch gap-2">
        {/* D-pad */}
        <div className="grid grid-cols-3 grid-rows-3 gap-1" style={{ width: 132 }}>
          <span />
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "N"))}>↑</Btn>
          <span />
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "W"))}>←</Btn>
          <div className="flex items-center justify-center text-[9px] text-[var(--ink-dim)]">{player.stamina}⚡</div>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "E"))}>→</Btn>
          <span />
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "S"))}>↓</Btn>
          <span />
        </div>

        {/* Pack + actions */}
        <div className="flex flex-1 flex-col gap-1">
          <div className="inset flex-1 overflow-y-auto scroll-thin rounded p-1 text-[10px]">
            <div className="flex items-center justify-between text-[var(--ink-dim)]">
              <span className="title">Pack {exp.backpackUsed}/{exp.carryCap}</span>
              <span>🧨 {ammo}</span>
            </div>
            {exp.backpack.length === 0 && <div className="py-1 text-[var(--ink-dim)]">empty</div>}
            {exp.backpack.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-0.5">
                <span className="truncate">{b.icon} {b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ""}</span>
                {b.category === "CONSUMABLE" && (
                  <button disabled={isPending} className="text-[var(--amber)] disabled:opacity-40" onClick={() => run(() => useConsumable(player.id, b.id))}>use</button>
                )}
              </div>
            ))}
          </div>
          <Btn variant="go" disabled={isPending || !!exp.pending} onClick={() => run(() => returnHome(player.id))} className="py-2">
            ⌂ Return Home {exp.distance > 0 ? `(risky: ${exp.distance} out)` : ""}
          </Btn>
        </div>
      </div>

      {consumables.length === 0 && player.health < player.maxHealth * 0.4 && (
        <div className="text-center text-[9px] text-[var(--blood)]">Low health, no meds — consider heading home.</div>
      )}
    </div>
  );
}
