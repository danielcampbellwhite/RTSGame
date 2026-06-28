"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/store/game";
import { resolveEncounter, useConsumable } from "@/app/actions";
import { useAction } from "@/components/ui";

/** Pokémon-style battle screen. Shown while there's a pending enemy; resolves
 *  through the existing combat server action. Placeholder pixel sprites. */
export default function Battle() {
  const snap = useGame((s) => s.snapshot)!;
  const { run, isPending } = useAction();
  const { player, expedition: exp } = snap;
  const pending = exp?.pending;
  const [menu, setMenu] = useState<"main" | "item">("main");
  const [shakeFoe, setShakeFoe] = useState(false);
  const [shakeMe, setShakeMe] = useState(false);
  const prevFoeHp = useRef<number | null>(null);
  const prevHp = useRef(player.health);

  useEffect(() => {
    if (!pending || pending.kind !== "enemy") return;
    if (prevFoeHp.current != null && pending.hp < prevFoeHp.current) {
      setShakeFoe(true);
      const t = setTimeout(() => setShakeFoe(false), 320);
      return () => clearTimeout(t);
    }
    prevFoeHp.current = pending.hp;
  }, [pending]);

  useEffect(() => {
    if (player.health < prevHp.current) {
      setShakeMe(true);
      const t = setTimeout(() => setShakeMe(false), 320);
      prevHp.current = player.health;
      return () => clearTimeout(t);
    }
    prevHp.current = player.health;
  }, [player.health]);

  if (!exp || !pending || pending.kind !== "enemy") return null;
  const consumables = exp.backpack.filter((b) => b.category === "CONSUMABLE");
  const log = exp.log[0] ?? "A foe blocks your path!";

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "linear-gradient(180deg,#1a1410,#0c0a08)", imageRendering: "pixelated" }}>
      {/* Foe */}
      <div className="relative flex-1">
        <div className="absolute right-6 top-8 w-40">
          <div className="panel rounded px-2 py-1 text-[0.66rem]">
            <div className="flex items-center justify-between">
              <span className="text-[#ffb4b4]">{pending.name}</span>
              {pending.elite && <span className="text-[var(--blood)]">elite</span>}
            </div>
            <HpBar value={pending.hp} max={pending.maxHp} />
          </div>
        </div>
        <div className={`absolute right-12 top-24 ${shakeFoe ? "battle-shake" : ""}`}>
          <Sprite emoji={pending.icon} bg="#5a2a2a" big />
        </div>
      </div>

      {/* Me */}
      <div className="relative flex-1">
        <div className={`absolute bottom-6 left-10 ${shakeMe ? "battle-shake" : ""}`}>
          <Sprite emoji="🧍" bg="#3a3320" big />
        </div>
        <div className="absolute bottom-24 right-6 w-44">
          <div className="panel rounded px-2 py-1 text-[0.66rem]">
            <div className="flex items-center justify-between">
              <span className="text-[#d8f3a8]">{player.name}</span>
              <span className="text-[var(--ink-dim)]">Lv{player.level}</span>
            </div>
            <HpBar value={player.health} max={player.maxHealth} />
            <div className="mt-0.5 text-right text-[0.55rem] text-[var(--ink-dim)]">{player.health}/{player.maxHealth}</div>
          </div>
        </div>
      </div>

      {/* Command box */}
      <div className="panel m-2 rounded p-2" style={{ borderColor: "var(--blood)" }}>
        <div className="mb-2 min-h-[2.2em] text-[0.72rem] text-[var(--ink)]">{log}</div>
        {menu === "main" ? (
          <div className="grid grid-cols-2 gap-2">
            <BtnBig disabled={isPending} onClick={() => run(() => resolveEncounter(player.id, "fight"))}>⚔️ Attack</BtnBig>
            <BtnBig disabled={isPending || consumables.length === 0} onClick={() => setMenu("item")}>🎒 Item</BtnBig>
            <BtnBig disabled={isPending} onClick={() => run(() => resolveEncounter(player.id, "flee"))}>🏃 Flee</BtnBig>
            <div className="flex items-center justify-center text-[0.58rem] text-[var(--ink-dim)]">pow {pending.power}</div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="max-h-28 overflow-y-auto scroll-thin">
              {consumables.map((c) => (
                <button key={c.id} disabled={isPending} className="inset flex w-full items-center justify-between rounded px-2 py-1 text-xs disabled:opacity-40" onClick={() => run(() => useConsumable(player.id, c.id))}>
                  <span>{c.icon} {c.name}{c.quantity > 1 ? ` ×${c.quantity}` : ""}</span>
                  <span className="text-[var(--good)]">use</span>
                </button>
              ))}
            </div>
            <BtnBig disabled={isPending} onClick={() => setMenu("main")}>← Back</BtnBig>
          </div>
        )}
      </div>
    </div>
  );
}

function HpBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const col = pct > 50 ? "#7bbf5a" : pct > 20 ? "#e0a32e" : "#b13838";
  return (
    <div className="mt-1 h-2 w-full overflow-hidden rounded-full border border-[rgba(0,0,0,0.4)] bg-[rgba(0,0,0,0.4)]">
      <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: col }} />
    </div>
  );
}

function Sprite({ emoji, bg, big }: { emoji: string; bg: string; big?: boolean }) {
  const s = big ? 88 : 56;
  return (
    <div className="flex items-center justify-center rounded-lg" style={{ width: s, height: s, background: bg, border: "2px solid rgba(0,0,0,0.5)", fontSize: s * 0.6, lineHeight: 1 }}>
      {emoji}
    </div>
  );
}

function BtnBig({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn rounded py-2.5 text-xs disabled:opacity-40">
      {children}
    </button>
  );
}
