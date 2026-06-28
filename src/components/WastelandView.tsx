"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/store/game";
import { Btn, Meter, useAction } from "@/components/ui";
import { move, resolveEncounter, exitBuilding, enterBuilding, returnHome, useConsumable, interact, recruitSurvivor, trade, helpInjured, takeGroundItem, takeAllGround, dropItem, type Dir } from "@/app/actions";
import type { GameSnapshot, ExpeditionView } from "@/lib/types";

const TIER_COLOR = ["#7bbf5a", "#9aa3ab", "#c9b24a", "#d98a36", "#c25a3a", "#b13838"];

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
  const inside = exp.mode === "INTERIOR";

  return (
    <div className="grime relative flex h-full w-full flex-col gap-2 overflow-y-auto scroll-thin p-2">
      {/* HUD */}
      <div className="panel rounded p-2">
        <div className="flex items-center justify-between text-[0.66rem]">
          <span className="title text-[var(--amber)]" title={exp.conditionNote}>{exp.conditionIcon} {exp.conditionName}</span>
          <span className="text-[var(--ink-dim)]">{exp.locationIcon} {exp.locationName}{inside ? ` · T${exp.tier}` : ""}</span>
        </div>
        <div className="mt-0.5 text-[0.58rem] text-[var(--ink-dim)]">
          {inside ? "Loot the rooms — your way out is the 🚪 you came in by." : "Roam the streets · step into a building's door to loot it · 🏠 to bank."}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Meter label="Health" value={player.health} max={player.maxHealth} color="#b13838" critical={player.health <= player.maxHealth * 0.3} />
          <Meter label="Stamina" value={player.stamina} max={100} color="#e0a32e" critical={player.stamina <= 15} />
          <Meter label="Radiation" value={player.radiation} max={100} color="#8fbf3f" critical={player.radiation >= 60} />
        </div>
      </div>

      {/* Top-down view, player centred. A city minimap overlays the corner. */}
      <div className="wasteland-bg panel relative flex shrink-0 items-center justify-center overflow-hidden rounded p-2" style={{ ["--biome" as string]: exp.biomeColor, height: "min(82vw, 360px)" }}>
        <div className="grid aspect-square h-full max-w-full gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {exp.tiles.map((t) => {
            let bg = "transparent";
            let border = "1px solid rgba(255,255,255,0.04)";
            let content = "";
            let opacity = 1;
            let color: string | undefined;
            if (t.edge) {
              bg = "rgba(10,8,7,0.85)";
              border = "1px solid rgba(0,0,0,0.5)";
            } else if (t.isPlayer) {
              bg = "rgba(58,47,35,0.9)";
              border = "1px solid var(--amber)";
              content = "🧍";
            } else if (t.kind === "BUILDING") {
              bg = "rgba(20,17,14,0.95)";
              border = "1px solid rgba(0,0,0,0.45)";
            } else if (t.kind === "DOOR") {
              bg = "rgba(58,47,35,0.6)";
              border = "1px solid var(--amber)";
              content = t.icon ?? "🚪";
            } else if (t.kind === "SHELTER") {
              bg = "rgba(47,58,42,0.8)";
              border = "1px solid var(--good)";
              content = "🏠";
            } else if (t.visited) {
              bg = "rgba(58,47,35,0.45)";
              border = "1px solid rgba(224,163,46,0.25)";
              content = t.feature === "EMPTY" ? "·" : t.icon ?? "";
              if (t.feature === "EMPTY") color = "rgba(224,163,46,0.4)";
            } else if (t.spotted) {
              bg = mix(t.color ?? "#2a241d", 0.3);
              border = "1px dashed rgba(224,163,46,0.4)";
              content = t.feature === "EMPTY" ? "" : t.icon ?? "";
              opacity = 0.7;
            } else if (t.revealed) {
              bg = mix(t.color ?? "#2a241d", 0.5);
              content = t.feature === "EMPTY" ? "" : t.icon ?? "";
              if (t.isExit) { border = "1px solid var(--tox)"; content = "🚪"; }
            } else if (t.scouted) {
              bg = mix(t.color ?? "#2a241d", 0.16);
              border = "1px dashed rgba(255,255,255,0.12)";
              content = "·";
              color = "rgba(232,221,203,0.3)";
            }
            return (
              <div
                key={`${t.x},${t.y}`}
                title={t.edge ? "" : t.revealed ? t.label : t.scouted ? "unexplored" : "unexplored"}
                className={`flex aspect-square items-center justify-center rounded-[2px] text-[0.8rem] ${t.isPlayer ? "ring-2 ring-[var(--amber)]" : ""}`}
                style={{ background: bg, border, color, opacity }}
              >
                {content}
              </div>
            );
          })}
        </div>
        <Minimap exp={exp} />
      </div>

      {/* Encounter cards */}
      {exp.pending && exp.pending.kind === "enemy" && (
        <div className="panel rounded p-2" style={{ borderColor: "var(--blood)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{exp.pending.icon}</span>
              <div>
                <div className="text-sm text-[#ffb4b4]">{exp.pending.name}</div>
                <div className="text-[0.66rem] text-[var(--ink-dim)]">power {exp.pending.power} · hp {exp.pending.hp}/{exp.pending.maxHp}</div>
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
                <div className="text-[0.66rem] text-[var(--ink-dim)]">a survivor — recruit to your shelter?</div>
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
          <div className="text-[0.58rem] text-[var(--ink-dim)]">pay with 🔩 scrap from your pack (you have {scrap})</div>
          <div className="mt-1 grid grid-cols-1 gap-1">
            {exp.pending.offers.map((o, i) => (
              <div key={i} className="inset flex items-center justify-between rounded px-2 py-1 text-xs">
                <span>{o.icon} {o.name}</span>
                <Btn disabled={isPending || scrap < o.price} onClick={() => run(() => trade(player.id, { type: "buy", index: i }))}>{o.price} 🔩</Btn>
              </div>
            ))}
            {exp.pending.offers.length === 0 && <div className="text-[0.66rem] text-[var(--ink-dim)]">Sold out. Sell from your pack below, or leave.</div>}
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
                <div className="text-[0.66rem] text-[var(--ink-dim)]">wounded — needs a {exp.pending.needName}</div>
              </div>
            </div>
            <div className="flex gap-1">
              <Btn variant="go" disabled={isPending} onClick={() => run(() => helpInjured(player.id, true))}>Help</Btn>
              <Btn disabled={isPending} onClick={() => run(() => helpInjured(player.id, false))}>Leave</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Ground — items lying on your current tile */}
      {exp.ground.length > 0 && (
        <div className="panel rounded p-2">
          <div className="mb-1 flex items-center justify-between text-[0.66rem] text-[var(--ink-dim)]">
            <span className="title">🔻 On the ground</span>
            <Btn disabled={blocked} onClick={() => run(() => takeAllGround(player.id))}>Take all</Btn>
          </div>
          <div className="max-h-20 overflow-y-auto scroll-thin">
            {exp.ground.map((g) => (
              <div key={g.idx} className="flex items-center justify-between py-0.5 text-[0.72rem]">
                <span className="truncate">{g.icon} {g.name}{g.quantity > 1 ? ` ×${g.quantity}` : ""}{g.durability != null ? ` (dur ${g.durability})` : ""}</span>
                <button disabled={blocked} className="text-[var(--good)] disabled:opacity-40" onClick={() => run(() => takeGroundItem(player.id, g.idx))}>take</button>
              </div>
            ))}
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
          <div className="flex items-center justify-center text-[0.58rem] text-[var(--ink-dim)]">{player.stamina}⚡</div>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "E"))}>→</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "SW"))}>↙</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "S"))}>↓</Btn>
          <Btn disabled={blocked} onClick={() => run(() => move(player.id, "SE"))}>↘</Btn>
        </div>

        {/* Pack + actions */}
        <div className="flex flex-1 flex-col gap-1">
          <div className="inset flex-1 overflow-y-auto scroll-thin rounded p-1 text-[0.66rem]" style={{ maxHeight: 80 }}>
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
                  <span className="flex shrink-0 gap-2">
                    {b.category === "CONSUMABLE" && (
                      <button disabled={isPending} className="text-[var(--amber)] disabled:opacity-40" onClick={() => run(() => useConsumable(player.id, b.id))}>use</button>
                    )}
                    <button disabled={blocked} className="text-[var(--ink-dim)] disabled:opacity-40" onClick={() => run(() => dropItem(player.id, b.id))}>drop</button>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <Btn disabled={blocked} onClick={() => run(() => interact(player.id, "look"))}>Look</Btn>
            <Btn disabled={blocked || exp.searchedHere} onClick={() => run(() => interact(player.id, "search"))}>{exp.searchedHere ? "Searched" : "Search"}</Btn>
            <Btn disabled={blocked} onClick={() => run(() => interact(player.id, "rest"))}>Rest</Btn>
          </div>
          {inside ? (
            <Btn variant="go" disabled={isPending || !!exp.pending} onClick={() => run(() => exitBuilding(player.id))} className="py-1.5">
              🚪 Exit to street
            </Btn>
          ) : exp.onDoor ? (
            <Btn variant="go" disabled={blocked} onClick={() => run(() => enterBuilding(player.id, exp.onDoor!.id))} className="py-1.5">
              ⮧ Enter {exp.onDoor.name}
            </Btn>
          ) : (
            <Btn variant="go" disabled={isPending || !!exp.pending || !exp.nearShelter} onClick={() => run(() => returnHome(player.id))} className="py-1.5">
              {exp.nearShelter ? "⌂ Return Home (bank loot)" : "⌂ Reach 🏠 on the map to bank"}
            </Btn>
          )}
        </div>
      </div>

      <Terminal snap={snap} run={run} disabled={isPending} />
    </div>
  );
}

/** City-wide minimap overlaid in the map's corner: shelter, buildings, you. */
function Minimap({ exp }: { exp: ExpeditionView }) {
  const N = exp.cityDim;
  const pct = (v: number) => ((v + 0.5) / N) * 100;
  const here = exp.minimap.find((m) => m.here);
  const px = exp.mode === "CITY" ? exp.posX : here?.x ?? exp.shelter.x;
  const py = exp.mode === "CITY" ? exp.posY : here?.y ?? exp.shelter.y;
  return (
    <div className="absolute right-1 top-1 z-10 overflow-hidden rounded border border-[rgba(224,163,46,0.35)]" style={{ width: 96, height: 96, background: "rgba(8,6,5,0.78)" }}>
      {/* shelter */}
      <span className="absolute -translate-x-1/2 -translate-y-1/2 text-[8px]" style={{ left: `${pct(exp.shelter.x)}%`, top: `${pct(exp.shelter.y)}%` }}>🏠</span>
      {/* buildings */}
      {exp.minimap.map((m) => (
        <span
          key={`${m.x},${m.y}`}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[1px]"
          title={`${m.name} · T${m.tier}`}
          style={{
            left: `${pct(m.x)}%`, top: `${pct(m.y)}%`,
            width: m.here ? 6 : 4, height: m.here ? 6 : 4,
            background: TIER_COLOR[m.tier] ?? "#9aa3ab",
            outline: m.here ? "1px solid var(--amber)" : "none",
          }}
        />
      ))}
      {/* you */}
      <span className="pulse absolute -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${pct(px)}%`, top: `${pct(py)}%`, width: 5, height: 5, background: "var(--amber)", boxShadow: "0 0 4px var(--amber)" }} />
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
    } else if (["enter", "in"].includes(verb)) {
      if (!exp.onDoor) return setNote("No door here to enter.");
      run(() => enterBuilding(player.id, exp.onDoor!.id));
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
    } else if (["exit", "out", "leave"].includes(verb) && exp.mode === "INTERIOR" && !pk) {
      run(() => exitBuilding(player.id));
    } else if (["r", "return", "home", "bank"].includes(verb)) {
      if (pk === "enemy") return setNote("Can't leave mid-fight.");
      if (pk === "survivor") return run(() => recruitSurvivor(player.id, false));
      if (pk === "trader") return run(() => trade(player.id, { type: "leave" }));
      if (pk === "injured") return run(() => helpInjured(player.id, false));
      if (exp.mode === "INTERIOR") return run(() => exitBuilding(player.id));
      if (!exp.nearShelter) return setNote("Head to your shelter (🏠) to bank.");
      run(() => returnHome(player.id));
    } else if (["look", "l", "examine", "scan"].includes(verb)) {
      run(() => interact(player.id, "look"));
    } else if (verb === "search") {
      if (exp.pending) return setNote("Deal with the threat first.");
      run(() => interact(player.id, "search"));
    } else if (verb === "rest") {
      if (exp.pending) return setNote("Can't rest with a threat present.");
      run(() => interact(player.id, "rest"));
    } else if (["take", "grab", "loot"].includes(verb)) {
      if (exp.pending) return setNote("Not while something's in your face.");
      run(() => takeAllGround(player.id));
    } else if (["use", "heal"].includes(verb)) {
      const want = verb === "heal" ? "" : arg;
      const item = exp.backpack.find((b) => b.category === "CONSUMABLE" && (want ? b.name.toLowerCase().includes(want) : true));
      if (!item) return setNote("No matching consumable in your pack.");
      run(() => useConsumable(player.id, item.id));
    } else if (verb === "help") {
      setNote("move: n s e w ne nw se sw · search · take · look · rest · enter · exit · fight · flee · recruit · buy [n] · aid · use [item] · return");
    } else {
      setNote(`Unknown command: ${verb}`);
    }
  };

  // Server log is stored newest-first; show oldest→newest so it reads like a feed.
  const feed = [...exp!.log].reverse();

  return (
    <div className="panel shrink-0 rounded p-2">
      <div ref={ref} className="h-24 overflow-y-auto scroll-thin pr-1 text-[0.72rem] leading-relaxed">
        {feed.map((l, i) => (
          <div key={i} className="text-[var(--ink)]">
            <span className="text-[var(--ink-dim)]">› </span>{l}
          </div>
        ))}
      </div>
      <div className="mt-1 text-[0.58rem] text-[var(--amber)]">{note}</div>
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
