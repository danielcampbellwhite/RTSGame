// Tiny synthesized notification blip via the Web Audio API — no asset to ship.
// The AudioContext is created lazily on first use (after a user gesture, which
// has always happened by the time a game is running).

let ctx: AudioContext | null = null;

export function playBlip(volume = 0.15): void {
  if (typeof window === "undefined") return;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // Two quick rising tones — a soft "command console" chirp.
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(990, now + 0.08);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    // Audio not available / blocked — silently ignore.
  }
}
