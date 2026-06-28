"use client";

import { useEffect, useState } from "react";
import { useGame, PID_KEY } from "@/store/game";
import { getState } from "@/app/actions";
import StartScreen from "@/components/StartScreen";
import ShelterView from "@/components/ShelterView";
import WastelandView from "@/components/WastelandView";

export default function Page() {
  const playerId = useGame((s) => s.playerId);
  const snapshot = useGame((s) => s.snapshot);
  const setPlayerId = useGame((s) => s.setPlayerId);
  const setSnapshot = useGame((s) => s.setSnapshot);
  const [booting, setBooting] = useState(true);

  // Resolve the saved player on mount.
  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem(PID_KEY) : null;
    if (!id) {
      setBooting(false);
      return;
    }
    (async () => {
      const snap = await getState(id);
      if (snap) {
        setPlayerId(id);
        setSnapshot(snap);
      } else {
        localStorage.removeItem(PID_KEY);
      }
      setBooting(false);
    })();
  }, [setPlayerId, setSnapshot]);

  // While safe at the shelter, refresh periodically so resource depletion shows.
  useEffect(() => {
    if (!playerId || snapshot?.player.state !== "AT_SHELTER") return;
    const t = setInterval(async () => {
      const snap = await getState(playerId);
      if (snap) setSnapshot(snap);
    }, 30_000);
    return () => clearInterval(t);
  }, [playerId, snapshot?.player.state, setSnapshot]);

  if (booting) return <Center>Recovering signal…</Center>;
  if (!playerId || !snapshot) return <StartScreen />;
  if (snapshot.player.state !== "IN_EXPEDITION") return <ShelterView />;
  return <WastelandView />;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-[var(--ink-dim)]">
      <span className="flicker">{children}</span>
    </div>
  );
}
