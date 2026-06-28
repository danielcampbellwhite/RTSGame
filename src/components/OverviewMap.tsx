"use client";

import { useGame } from "@/store/game";
import { Btn, Meter, useAction } from "@/components/ui";
import { enterZone, returnHome } from "@/app/actions";
import { LINKS } from "@/data/zones";
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

  // Resolve the road network into draw-able segments in the 0–100 coordinate
  // space the markers live in, so roads and pins always correlate.
  const pos: Record<string, OverviewZone> = Object.fromEntries(ov.zones.map((z) => [z.key, z]));
  const roads = LINKS.map(([a, b]) => ({ a: pos[a], b: pos[b] })).filter((s) => s.a && s.b);

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

      {/* The city map: a correlated overlay (roads, grid, zones) drawn on top
          of a dimmed, desaturated atmospheric backdrop image. */}
      <div
        className="panel relative w-full shrink-0 overflow-hidden rounded"
        style={{ aspectRatio: "5 / 4", backgroundColor: "#0b0908" }}
      >
        {/* atmospheric backdrop — purely decorative, heavily dimmed so the
            overlay reads clearly even though the art doesn't match coordinates */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "url('/citymap.png')",
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "grayscale(0.7) brightness(0.42) contrast(1.05) sepia(0.25)",
          }}
        />
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 90% at 44% 82%, rgba(123,191,90,0.10), transparent 55%), linear-gradient(180deg, rgba(10,8,7,0.45), rgba(10,8,7,0.72))" }} />

        {/* correlated overlay — same 0–100 space as the markers */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* faint coordinate grid */}
          {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((g) => (
            <g key={g} stroke="rgba(224,163,46,0.06)" strokeWidth={0.2}>
              <line x1={g} y1={0} x2={g} y2={100} />
              <line x1={0} y1={g} x2={100} y2={g} />
            </g>
          ))}
          {/* road casings then centerlines */}
          {roads.map((s, i) => (
            <line key={`c${i}`} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="rgba(20,16,13,0.85)" strokeWidth={2.4} strokeLinecap="round" />
          ))}
          {roads.map((s, i) => (
            <line key={`r${i}`} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="rgba(190,170,120,0.32)" strokeWidth={0.7} strokeLinecap="round" strokeDasharray="1.6 1.6" />
          ))}
        </svg>

        {/* region glows behind each zone, tinted by its type */}
        {ov.zones.map((z) => (
          <div
            key={`glow-${z.key}`}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${z.x}%`,
              top: `${z.y}%`,
              width: z.type === "SAFE" ? "22%" : "16%",
              height: z.type === "SAFE" ? "22%" : "16%",
              background: `radial-gradient(circle, ${z.color}33, transparent 70%)`,
            }}
          />
        ))}

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
