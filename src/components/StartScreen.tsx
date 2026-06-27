"use client";

import { useState } from "react";
import { createPlayer, getState } from "@/app/actions";
import { useGame, PID_KEY } from "@/store/game";
import { Btn } from "@/components/ui";

export default function StartScreen() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const setPlayerId = useGame((s) => s.setPlayerId);
  const setSnapshot = useGame((s) => s.setSnapshot);

  const begin = async () => {
    setBusy(true);
    const { playerId } = await createPlayer(name);
    localStorage.setItem(PID_KEY, playerId);
    setPlayerId(playerId);
    setSnapshot(await getState(playerId));
  };

  const load = async () => {
    const id = code.trim();
    if (!id) return;
    setBusy(true);
    const snap = await getState(id);
    if (snap) {
      localStorage.setItem(PID_KEY, id);
      setPlayerId(id);
      setSnapshot(snap);
    } else setBusy(false);
  };

  return (
    <div className="grime relative flex h-full w-full flex-col items-center justify-center gap-5 overflow-y-auto p-6">
      <div className="text-center">
        <h1 className="title stamp text-3xl font-bold tracking-[0.2em] text-[var(--rust)]">AFTERMATH</h1>
        <p className="mt-2 max-w-xs text-xs leading-relaxed text-[var(--ink-dim)]">
          The bombs fell. The shelter is safety. The wasteland is opportunity.
          Every trip out is a gamble: <em>do I go home now, or risk one more building?</em>
        </p>
      </div>

      <div className="panel w-full max-w-xs rounded p-4">
        <label className="title text-[10px] text-[var(--ink-dim)]">Survivor name</label>
        <input
          autoFocus
          value={name}
          maxLength={24}
          placeholder="e.g. Vex"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && begin()}
          className="inset mt-1 w-full rounded px-3 py-2 text-sm outline-none"
        />
        <Btn variant="go" disabled={busy} onClick={begin} className="mt-3 w-full py-3">
          {busy ? "Entering…" : "Enter the Wasteland"}
        </Btn>
      </div>

      <div className="w-full max-w-xs">
        <div className="title mb-1 text-center text-[10px] text-[var(--ink-dim)]">Resume a save</div>
        <div className="flex gap-1">
          <input
            value={code}
            placeholder="paste save code"
            onChange={(e) => setCode(e.target.value)}
            className="inset flex-1 rounded px-2 py-1.5 text-xs outline-none"
          />
          <Btn disabled={busy} onClick={load}>Load</Btn>
        </div>
      </div>
    </div>
  );
}
