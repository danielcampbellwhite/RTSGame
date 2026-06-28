"use client";

import { useGame } from "@/store/game";
import { Btn, Meter, useAction } from "@/components/ui";
import { enterZone, returnHome } from "@/app/actions";
import type { OverviewZone } from "@/lib/types";

const LEGEND: { type: string; icon: string; color: string; label: string }[] = [
  { type: "SAFE", icon: "🏠", color: "#7bbf5a", label: "Safe Zone" },
  { type: "WASTELAND", icon: "☠️", color: "#9aa3ab", label: "Wasteland" },
  { type: "POI", icon: "⭐", color: "#e0a32e", label: "Point of Interest" },
  { type: "DANGER", icon: "💀", color: "#b13838", label: "Danger Zone" },
];

export default function OverviewMap() {
  const snap = useGame((s) => s.snapshot)!;
  const { run, isPending } = useAction();
  const ov = snap.overview;
  if (!ov) return null;
  const { player } = snap;

  const onZone = (z: OverviewZone) => {
    if (z.type === "SAFE") run(() => returnHome(player.id));
    else run(() => enterZone(player.id, z.key));
  };

  return (
    <div className="grime relative flex h-full w-full flex-col gap-2 overflow-y-auto scroll-thin p-2">
      {/* HUD */}
      <div className="panel rounded p-2">
        <div className="flex items-center justify-between text-[0.66rem]">
          <span className="title text-[var(--amber)]" title={ov.conditionNote}>{ov.conditionIcon} {ov.conditionName}</span>
          <span className="text-[var(--ink-dim)]">City Map · pack {ov.backpackCount}/{ov.carryCap}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Meter label="Health" value={player.health} max={player.maxHealth} color="#b13838" critical={player.health <= player.maxHealth * 0.3} />
          <Meter label="Stamina" value={player.stamina} max={100} color="#e0a32e" critical={player.stamina <= 15} />
          <Meter label="Radiation" value={player.radiation} max={100} color="#8fbf3f" critical={player.radiation >= 60} />
        </div>
      </div>

      {/* The city map: zones plotted by coordinate over the backdrop */}
      <div
        className="panel relative w-full shrink-0 overflow-hidden rounded"
        style={{
          aspectRatio: "5 / 4",
          backgroundColor: "#0b0908",
          backgroundImage: "linear-gradient(180deg, rgba(12,10,8,0.35), rgba(12,10,8,0.55)), url('/citymap.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* legend */}
        <div className="panel absolute left-1 top-1 z-10 rounded p-1.5 text-[0.55rem]">
          {LEGEND.map((l) => (
            <div key={l.type} className="flex items-center gap-1">
              <span>{l.icon}</span>
              <span style={{ color: l.color }}>{l.label}</span>
            </div>
          ))}
        </div>
        {/* compass */}
        <div className="absolute right-2 top-1 z-10 text-center text-[var(--ink-dim)]">
          <div className="text-sm">✦</div>
          <div className="text-[0.5rem]">N</div>
        </div>

        {/* zone markers */}
        {ov.zones.map((z) => (
          <button
            key={z.key}
            disabled={isPending}
            onClick={() => onZone(z)}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2 disabled:opacity-50"
            style={{ left: `${z.x}%`, top: `${z.y}%` }}
            title={z.type === "SAFE" ? "Return to your shelter" : `${z.name} — Tier ${z.tier}${z.faction ? ` · ${z.faction} (${z.standing})` : ""}`}
          >
            <div className="flex flex-col items-center">
              <span className="text-base leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{z.icon}</span>
              <span
                className="mt-0.5 whitespace-nowrap rounded px-1 text-[0.5rem] leading-tight"
                style={{ background: "rgba(8,6,5,0.8)", color: z.color, border: `1px solid ${z.color}55` }}
              >
                {z.name}{z.type !== "SAFE" ? ` ·T${z.tier}` : ""}
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="text-center text-[0.6rem] text-[var(--ink-dim)]">
        Tap a zone to travel there and raid it. Tap your <span className="text-[var(--good)]">🏠 Shelter</span> to head home and bank your haul.
      </div>

      <Btn variant="go" disabled={isPending} onClick={() => run(() => returnHome(player.id))} className="w-full py-2.5">
        ⌂ Return to Shelter (bank loot)
      </Btn>
    </div>
  );
}
