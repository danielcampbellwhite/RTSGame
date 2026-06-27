"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/store/game";
import { Btn, Meter, useAction } from "@/components/ui";
import { move, resolveEncounter, returnHome, useConsumable, interact, recruitSurvivor, trade, helpInjured, type Dir } from "@/app/actions";
import type { GameSnapshot } from "@/lib/types";

export default function WastelandView() {
  const snap = useGame((s) => s.snapshot)!;
  const { run, isPending } = useAction();
  const { player, expedition: exp } = snap;
  if (!exp) return null;

  const cols = exp.windowRadius * 2 + 1;
  const ammo = exp.backpack.filter((b) => b.defKey === "ammo").reduce((n, b) => n + b.quantity, 0);
  const scrap = exp.backpack.filter((b) => b.defKey === "scrap").reduce((n, b) => n + b.quantity, 0);
  const isTrader = exp.pending?.kind === "trader";
  const blocked = !!exp.pending || isPending;

  return (
    <div className="grime relative flex h-full w-full flex-col gap-2 overflow-hidden p-2">
      {/* HUD */}
      <div className="panel rounded p-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="title text-[var(--rust)]">{exp.conditionIcon} {exp.conditionName}</span>
          <span className="text-[var(--ink-dim)]">{exp.biomeName} · {exp.distance} out · T{exp.tier}</span>
        </div>
        <div className="mt-0.5 text-[9px] text-[var(--ink-dim)]">
          {exp.territoryName ? `Territory: ${exp.territoryName} · ${exp.territoryStanding}` : "Territory: unclaimed wastes"}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Meter label="Health" value={player.health} max={player.maxHealth} color="#b13838" />
          <Meter label="Stamina" value={player.stamina} max={100} color="#e0a32e" />
          <Meter label="Radiation" value={player.radiation} max={100} color="#8fbf3f" />
        </div>
      </div>

      {/* Map with environmental backdrop */}
      <div className="wasteland-bg panel relative min-h-0 flex-1 overflow-hidden rounded p-3" style={{ ["--biome" as string]: exp.biomeColor }}>
        <div className="relative mx-auto grid h-full w-full max-w-[420px] gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {exp.tiles.map((t) => {
            let bg = "transparent";
            let border = "1px solid rgba(255,255,255,0.04)";
            let content = "";
            let opacity = 1;
            let color: string | undefined;
            if (t.isPlayer) {
              bg = "rgba(58,47,35,0.9)";
              border = "1px solid var(--amber)";
              content = "🧍";
            } else if (t.visited) {
              // your trail — explored ground
              bg = "rgba(58,47,35,0.45)";
              border = "1px solid rgba(224,163,46,0.25)";
              content = t.feature === "EMPTY" ? "·" : t.icon ?? "";
              if (t.feature === "EMPTY") color = "rgba(224,163,46,0.4)";
            } else if (t.spotted) {
              // seen from afar via look
              bg = mix(t.color ?? "#2a241d", 0.3);
              border = "1px dashed rgba(224,163,46,0.4)";
              content = t.feature === "EMPTY" ? "" : t.icon ?? "";
              opacity = 0.7;
            } else if (t.revealed) {
              bg = mix(t.color ?? "#2a241d", 0.5);
              content = t.feature === "EMPTY" ? "" : t.icon ?? "";
              if (t.isExit) border = "1px solid var(--tox)";
            } else if (t.scouted) {
              bg = mix(t.color ?? "#2a241d", 0.16);
              border = "1px dashed rgba(255,255,255,0.12)";
              content = "·";
              color = "rgba(232,221,203,0.3)";
            }
            return (
              <div
                key={`${t.x},${t.y}`}
                title={t.revealed ? t.label : t.scouted ? "scouted — unknown" : "unexplored"}
                className={`flex aspect-square items-center justify-center rounded-[2px] text-[12px] ${t.isPlayer ? "ring-2 ring-[var(--amber)]" : ""}`}
                style={{ background: bg, border, color, opacity }}
              >
                {content}
              </div>
            );
          })}
        </div>
      </div>

      {/* Encounter card */}
      {exp.pending && exp.pending.kind === "enemy" && (
        <div className="panel rounded p-2" style={{ borderColor: "var(--blood)" }}>
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
      )}
      {exp.pending && exp.pending.kind === "survivor" && (
        <div className="panel rounded p-2" style={{ borderColor: "var(--tox)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🧑</span>
              <div>
                <div className="text-sm text-[#d8f3a8]">{exp.pending.name}</div>
                <div className="text-[10px] text-[var(--ink-dim)]">a survivor — recruit to your shelter?</div>
              </div>
            </div>
            <div className="flex gap-1">
              <Btn variant="go" disabled={isPending} onClick={() => run(() => recruitSurvivor(player.id, true))}>Recruit</Btn>
              <Btn disabled={isPending} onClick={() => run(() => recruitSurvivor(player.id, false))}>Move On</Btn>
            </div>
          </div>
        </div>
      )}
      {exp.pending && exp.pending.kind === "trader" && (
        <div className="panel rounded p-2" style={{ borderColor: "var(--amber)" }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-[var(--amber)]">🧑‍🔧 {exp.pending.name} · Trader</span>
            <Btn disabled={isPending} onClick={() => run(() => trade(player.id, { type: "leave" }))}>Leave</Btn>
          </div>
          <div className="text-[9px] text-[var(--ink-dim)]">pay with 🔩 scrap from your pack (you have {scrap})</div>
          <div className="mt-1 grid grid-cols-1 gap-1">
            {exp.pending.offers.map((o, i) => (
              <div key={i} className="inset flex items-center justify-between rounded px-2 py-1 text-xs">
                <span>{o.icon} {o.name}</span>
                <Btn disabled={isPending || scrap < o.price} onClick={() => run(() => trade(player.id, { type: "buy", index: i }))}>{o.price} 🔩</Btn>
              </div>
            ))}
            {exp.pending.offers.length === 0 && <div className="text-[10px] text-[var(--ink-dim)]">Sold out. Sell from your pack below, or leave.</div>}
          </div>
        </div>
      )}
      {exp.pending && exp.pending.kind === "injured" && (
        <div className="panel rounded p-2" style={{ borderColor: "var(--blood)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🩸</span>
              <div>
                <div className="text-sm text-[#ffb4b4]">{exp.pending.name}</div>
                <div className="text-[10px] text-[var(--ink-dim)]">wounded — needs a {exp.pending.needName}</div>
              </div>
            </div>
            <div className="flex gap-1">
              <Btn variant="go" disabled={isPending} onClick={() => run(() => helpInjured(player.id, true))}>Help</Btn>
              <Btn disabled={isPending} onClick={() => run(() => helpInjured(player.id, false))}>Leave</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-stretch gap-2">
        {/* 8-way compass */}
        <div className="grid grid-cols-3 grid-rows-3 gap-1" style={{ width: 132 }}>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "NW"))}>↖</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "N"))}>↑</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "NE"))}>↗</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "W"))}>←</Btn>
          <div className="flex items-center justify-center text-[9px] text-[var(--ink-dim)]">{player.stamina}⚡</div>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "E"))}>→</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "SW"))}>↙</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "S"))}>↓</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "SE"))}>↘</Btn>
        </div>

        {/* Pack + actions */}
        <div className="flex flex-1 flex-col gap-1">
          <div className="inset flex-1 overflow-y-auto scroll-thin rounded p-1 text-[10px]" style={{ maxHeight: 80 }}>
            <div className="flex items-center justify-between text-[var(--ink-dim)]">
              <span className="title">Pack {exp.backpackUsed}/{exp.carryCap}</span>
              <span>🧨 {ammo}</span>
            </div>
            {exp.backpack.length === 0 && <div className="py-1 text-[var(--ink-dim)]">empty</div>}
            {exp.backpack.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-0.5">
                <span className="truncate">{b.icon} {b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ""}</span>
                {isTrader ? (
                  b.defKey !== "scrap" && (
                    <button disabled={isPending} className="text-[var(--amber)] disabled:opacity-40" onClick={() => run(() => trade(player.id, { type: "sell", itemId: b.id }))}>sell</button>
                  )
                ) : (
                  b.category === "CONSUMABLE" && (
                    <button disabled={isPending} className="text-[var(--amber)] disabled:opacity-40" onClick={() => run(() => useConsumable(player.id, b.id))}>use</button>
                  )
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <Btn disabled={blocked} onClick={() => run(() => interact(player.id, "look"))}>Look</Btn>
            <Btn disabled={blocked} onClick={() => run(() => interact(player.id, "search"))}>Search</Btn>
            <Btn disabled={blocked} onClick={() => run(() => interact(player.id, "rest"))}>Rest</Btn>
          </div>
          <Btn variant="go" disabled={isPending || !!exp.pending} onClick={() => run(() => returnHome(player.id))} className="py-1.5">
            ⌂ Return {exp.distance > 0 ? `(${exp.distance} out)` : ""}
          </Btn>
        </div>
      </div>

      <Terminal snap={snap} run={run} disabled={isPending} />
    </div>
  );
}

function mix(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Terminal ──────────────────────────────────────────────────────────────────

const MOVE_WORDS: Record<string, Dir> = {
  n: "N", north: "N", s: "S", south: "S", e: "E", east: "E", w: "W", west: "W",
  ne: "NE", northeast: "NE", nw: "NW", northwest: "NW",
  se: "SE", southeast: "SE", sw: "SW", southwest: "SW",
};

function Terminal({ snap, run, disabled }: { snap: GameSnapshot; run: (fn: () => Promise<GameSnapshot | null>) => void; disabled: boolean }) {
  const [cmd, setCmd] = useState("");
  const [note, setNote] = useState("type 'help' for commands");
  const ref = useRef<HTMLDivElement>(null);
  const { player, expedition: exp } = snap;

  // Auto-scroll to newest (bottom).
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [snap]);

  const submit = () => {
    const raw = cmd.trim().toLowerCase();
    if (!raw || !exp) return;
    setCmd("");
    const [verb, ...rest] = raw.split(/\s+/);
    const arg = rest.join(" ");
    const pk = exp.pending?.kind;
    setNote("");

    if (MOVE_WORDS[verb] || (verb === "go" && MOVE_WORDS[arg])) {
      if (exp.pending) return setNote("Something blocks your path — fight or flee.");
      run(() => move(player.id, MOVE_WORDS[verb] ?? MOVE_WORDS[arg]));
    } else if (["f", "fight", "attack"].includes(verb)) {
      if (exp.pending?.kind !== "enemy") return setNote("Nothing to fight here.");
      run(() => resolveEncounter(player.id, "fight"));
    } else if (["flee", "run", "escape"].includes(verb)) {
      if (exp.pending?.kind !== "enemy") return setNote("Nothing to flee from.");
      run(() => resolveEncounter(player.id, "flee"));
    } else if (["recruit", "invite"].includes(verb)) {
      if (pk !== "survivor") return setNote("No survivor here to recruit.");
      run(() => recruitSurvivor(player.id, true));
    } else if (verb === "buy") {
      if (pk !== "trader") return setNote("No trader here.");
      const idx = parseInt(arg, 10) - 1;
      if (Number.isNaN(idx)) return setNote("Usage: buy <number>");
      run(() => trade(player.id, { type: "buy", index: idx }));
    } else if (["aid", "give"].includes(verb)) {
      if (pk !== "injured") return setNote("No one here to aid.");
      run(() => helpInjured(player.id, true));
    } else if (["ignore", "dismiss", "wave", "moveon"].includes(verb)) {
      if (pk === "survivor") run(() => recruitSurvivor(player.id, false));
      else if (pk === "trader") run(() => trade(player.id, { type: "leave" }));
      else if (pk === "injured") run(() => helpInjured(player.id, false));
      else setNote("Nothing to ignore.");
    } else if (["r", "return", "home", "leave"].includes(verb)) {
      if (pk === "enemy") return setNote("Can't leave mid-fight.");
      if (pk === "survivor") return run(() => recruitSurvivor(player.id, false));
      if (pk === "trader") return run(() => trade(player.id, { type: "leave" }));
      if (pk === "injured") return run(() => helpInjured(player.id, false));
      run(() => returnHome(player.id));
    } else if (["look", "l", "examine", "scan"].includes(verb)) {
      run(() => interact(player.id, "look"));
    } else if (verb === "search") {
      if (exp.pending) return setNote("Deal with the threat first.");
      run(() => interact(player.id, "search"));
    } else if (verb === "rest") {
      if (exp.pending) return setNote("Can't rest with a threat present.");
      run(() => interact(player.id, "rest"));
    } else if (["use", "heal"].includes(verb)) {
      const want = verb === "heal" ? "" : arg;
      const item = exp.backpack.find((b) => b.category === "CONSUMABLE" && (want ? b.name.toLowerCase().includes(want) : true));
      if (!item) return setNote("No matching consumable in your pack.");
      run(() => useConsumable(player.id, item.id));
    } else if (verb === "help") {
      setNote("move: n s e w ne nw se sw · fight · flee · recruit · buy [n] · aid · ignore · search · rest · look · use [item] · return");
    } else {
      setNote(`Unknown command: ${verb}`);
    }
  };

  // Server log is stored newest-first; show oldest→newest so it reads like a feed.
  const feed = [...exp!.log].reverse();

  return (
    <div className="panel shrink-0 rounded p-2">
      <div ref={ref} className="h-24 overflow-y-auto scroll-thin pr-1 text-[11px] leading-relaxed">
        {feed.map((l, i) => (
          <div key={i} className="text-[var(--ink)]">
            <span className="text-[var(--ink-dim)]">› </span>{l}
          </div>
        ))}
      </div>
      <div className="mt-1 text-[9px] text-[var(--amber)]">{note}</div>
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[var(--tox)]">❯</span>
        <input
          value={cmd}
          disabled={disabled}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="type a command…"
          className="term-input inset flex-1 rounded px-2 py-1 text-xs outline-none"
        />
      </div>
    </div>
  );
}
