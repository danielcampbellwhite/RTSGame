"use client";

import { useGameStore } from "@/store/game";

const SEVERITY_COLOR = ["#7fe9f7", "#7fe9f7", "#fbbf24", "#ef4444"];

export default function EventFeed({ muted, onToggleMute }: { muted?: boolean; onToggleMute?: () => void }) {
  const snapshot = useGameStore((s) => s.snapshot);
  const events = snapshot?.events ?? [];

  return (
    <div className="panel glow-border h-full overflow-y-auto scroll-thin px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-cyan-200/75">Global Intelligence Feed</span>
        {onToggleMute && (
          <button
            onClick={onToggleMute}
            className="text-sm text-cyan-200/80 hover:text-[var(--wd-cyan)]"
            title={muted ? "Unmute alerts" : "Mute alerts"}
          >
            {muted ? "🔕" : "🔔"}
          </button>
        )}
      </div>
      {events.length === 0 && <div className="text-xs text-cyan-200/60">No reports yet. The world is quiet… for now.</div>}
      <ul className="space-y-0.5">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-2 text-xs">
            <span className="text-cyan-200/60">{new Date(e.createdAt).toLocaleTimeString()}</span>
            <span
              className="rounded px-1 text-[9px] uppercase"
              style={{ color: SEVERITY_COLOR[e.severity] ?? "#7fe9f7", border: `1px solid ${SEVERITY_COLOR[e.severity] ?? "#7fe9f7"}33` }}
            >
              {e.category}
            </span>
            <span style={{ color: SEVERITY_COLOR[e.severity] ?? "#cbe7f5" }}>{e.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
