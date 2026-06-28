"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/store/game";
import { useAction } from "@/components/ui";
import {
  syncPos, engage, enterBuilding, exitBuilding, returnHome, interact,
  takeGroundItem, takeAllGround, dropItem, useConsumable,
} from "@/app/actions";
import { makeScene, type Scene, type Terrain } from "@/lib/scene";
import type { GameSnapshot } from "@/lib/types";
import Battle from "@/components/Battle";

type Dir = "N" | "S" | "E" | "W";
const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

const TERRAIN_COLOR: Record<Terrain, string> = {
  STREET: "#36373d", LOT: "#4a4632", BUILDING: "#23262d", DOOR: "#5a4a30",
  SHELTER: "#2f5a37", FLOOR: "#3a3128", EXIT: "#5a4a30", EDGE: "#0b0a08",
};

interface Enemy { ox: number; oy: number; x: number; y: number; tx: number; ty: number; enemyKey: string; tier: number; icon: string; }
interface EngineState {
  px: number; py: number; face: Dir; moving: boolean;
  fromX: number; fromY: number; toX: number; toY: number; mt: number;
  camX: number; camY: number; enemies: Map<string, Enemy>;
  lastEnemyTick: number; t: number; cooldown: number; prevBattling: boolean;
}

const STEP_MS = 150;        // tile-to-tile walk time
const ENEMY_TICK_MS = 480;  // enemy decision cadence
const AGGRO = 4;            // tiles within which enemies chase
const SPAWN_R = 8;          // spawn enemies within this radius of the player
const VIS_R = 5;            // how far the player can see (tiles)

export default function Overworld() {
  const snap = useGame((s) => s.snapshot)!;
  const setSnapshot = useGame((s) => s.setSnapshot);
  const { run } = useAction();
  const { player, expedition: exp } = snap;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eng = useRef<EngineState | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const snapRef = useRef<GameSnapshot>(snap);
  const heldRef = useRef<Dir | null>(null);
  const busyRef = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBuilding = useRef<string | null | undefined>(undefined);

  const [overTile, setOverTile] = useState<{ feature: string; label?: string; near: { shelter: boolean; exit: boolean; door: string | null } }>({ feature: "NONE", near: { shelter: false, exit: false, door: null } });
  const [showPack, setShowPack] = useState(false);

  // keep refs fresh every render
  snapRef.current = snap;
  if (exp) sceneRef.current = makeScene(exp);

  // (re)initialise engine position when we enter/leave a building or first mount
  useEffect(() => {
    if (!exp) return;
    if (lastBuilding.current !== exp.buildingId) {
      lastBuilding.current = exp.buildingId;
      eng.current = {
        px: exp.posX, py: exp.posY, face: "S", moving: false,
        fromX: exp.posX, fromY: exp.posY, toX: exp.posX, toY: exp.posY, mt: 0,
        camX: exp.posX, camY: exp.posY, enemies: new Map(),
        lastEnemyTick: 0, t: 0, cooldown: 0, prevBattling: false,
      };
    }
  }, [exp]);

  // main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let prev = performance.now();

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const commitSync = (x: number, y: number) => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(async () => {
        const s = await syncPos(player.id, x, y);
        if (s) setSnapshot(s);
      }, 220);
    };

    const transition = async (fn: () => Promise<GameSnapshot | null>) => {
      busyRef.current = true;
      const s = await fn();
      if (s) setSnapshot(s);
      busyRef.current = false;
    };

    const onArrive = (st: EngineState, scene: Scene) => {
      const cell = scene.cellAt(st.toX, st.toY);
      if (cell.terrain === "DOOR" && cell.buildingId) {
        void transition(() => enterBuilding(player.id, cell.buildingId!));
      } else if (cell.terrain === "EXIT") {
        void transition(() => exitBuilding(player.id));
      } else {
        commitSync(st.toX, st.toY);
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - prev); prev = now;
      const st = eng.current; const scene = sceneRef.current; const s = snapRef.current;
      if (!st || !scene || !s.expedition) { return; }
      st.t += dt;
      const battling = !!s.expedition.pending;
      const frozen = battling || busyRef.current;
      // when a battle ends, give breathing room + shove survivors back so a
      // flee doesn't instantly re-trigger the same fight.
      if (st.prevBattling && !battling) {
        st.cooldown = 1400;
        for (const e of st.enemies.values()) {
          const ax = e.x + Math.sign(e.x - st.px) * 2, ay = e.y + Math.sign(e.y - st.py) * 2;
          if (sceneRef.current!.cellAt(Math.round(ax), Math.round(ay)).walkable) { e.tx = ax; e.ty = ay; }
        }
      }
      st.prevBattling = battling;

      // ── player movement ──────────────────────────────────────────────
      if (!frozen) {
        if (st.moving) {
          st.mt += dt;
          const k = Math.min(1, st.mt / STEP_MS);
          st.px = st.fromX + (st.toX - st.fromX) * k;
          st.py = st.fromY + (st.toY - st.fromY) * k;
          if (k >= 1) { st.moving = false; st.px = st.toX; st.py = st.toY; onArrive(st, scene); }
        } else {
          const dir = heldRef.current;
          if (dir) {
            st.face = dir;
            const [dx, dy] = DELTA[dir];
            const nx = st.toX + dx, ny = st.toY + dy;
            if (scene.cellAt(nx, ny).walkable) {
              st.fromX = st.toX; st.fromY = st.toY; st.toX = nx; st.toY = ny; st.mt = 0; st.moving = true;
            }
          }
        }
      }

      // ── enemies ──────────────────────────────────────────────────────
      // spawn from nearby ENEMY cells; drop ones now cleared
      const cxT = Math.round(st.px), cyT = Math.round(st.py);
      for (let yy = cyT - SPAWN_R; yy <= cyT + SPAWN_R; yy++) {
        for (let xx = cxT - SPAWN_R; xx <= cxT + SPAWN_R; xx++) {
          const c = scene.cellAt(xx, yy);
          const id = `${xx},${yy}`;
          if (c.feature === "ENEMY" && !st.enemies.has(id)) {
            st.enemies.set(id, { ox: xx, oy: yy, x: xx, y: yy, tx: xx, ty: yy, enemyKey: c.enemyKey ?? "scavenger", tier: c.tier ?? 1, icon: c.icon ?? "🧟" });
          }
        }
      }
      for (const [id, e] of st.enemies) {
        if (scene.cellAt(e.ox, e.oy).feature !== "ENEMY") { st.enemies.delete(id); continue; }
        if (Math.abs(e.ox - cxT) > SPAWN_R + 2 || Math.abs(e.oy - cyT) > SPAWN_R + 2) { st.enemies.delete(id); }
      }

      if (!frozen && st.t - st.lastEnemyTick > ENEMY_TICK_MS) {
        st.lastEnemyTick = st.t;
        for (const e of st.enemies.values()) {
          if (Math.abs(e.x - e.tx) > 0.01 || Math.abs(e.y - e.ty) > 0.01) continue; // still sliding
          const dist = Math.max(Math.abs(e.x - st.px), Math.abs(e.y - st.py));
          let nx = e.x, ny = e.y;
          if (dist <= AGGRO) {
            nx = e.x + Math.sign(st.px - e.x); ny = e.y + Math.sign(st.py - e.y);
            if (Math.abs(st.px - e.x) > Math.abs(st.py - e.y)) ny = e.y; else nx = e.x;
          } else if (Math.random() < 0.4) {
            const d = DELTA[(["N", "S", "E", "W"] as Dir[])[Math.floor(Math.random() * 4)]];
            nx = e.x + d[0]; ny = e.y + d[1];
          }
          if ((nx !== e.x || ny !== e.y) && scene.cellAt(Math.round(nx), Math.round(ny)).walkable) { e.tx = nx; e.ty = ny; }
        }
      }
      // slide enemies toward their target tile (frozen during battle)
      if (!frozen) {
        const es = dt / ENEMY_TICK_MS;
        for (const e of st.enemies.values()) {
          e.x += Math.max(-1, Math.min(1, (e.tx - e.x))) * es * 2;
          e.y += Math.max(-1, Math.min(1, (e.ty - e.y))) * es * 2;
          if (Math.abs(e.tx - e.x) < 0.02) e.x = e.tx;
          if (Math.abs(e.ty - e.y) < 0.02) e.y = e.ty;
        }
      }

      // contact → battle
      if (st.cooldown > 0) st.cooldown -= dt;
      if (!frozen && st.cooldown <= 0) {
        for (const e of st.enemies.values()) {
          if (Math.hypot(e.x - st.px, e.y - st.py) < 0.7) {
            st.cooldown = 1500;
            void transition(() => engage(player.id, e.enemyKey, e.tier, e.ox, e.oy));
            break;
          }
        }
      }

      // ── camera ───────────────────────────────────────────────────────
      st.camX += (st.px - st.camX) * Math.min(1, dt / 90);
      st.camY += (st.py - st.camY) * Math.min(1, dt / 90);

      draw(ctx, canvas, st, scene);

      // surface contextual info to React (cheap; only when idle)
      if (!st.moving && !frozen) {
        const here = scene.cellAt(st.toX, st.toY);
        const exp2 = s.expedition;
        const near = {
          shelter: exp2.mode === "CITY" && Math.max(Math.abs(st.toX - exp2.shelter.x), Math.abs(st.toY - exp2.shelter.y)) <= 1,
          exit: here.terrain === "EXIT",
          door: here.terrain === "DOOR" ? here.buildingName ?? null : null,
        };
        setOverTile((p) => (p.feature === here.feature && p.near.shelter === near.shelter && p.near.exit === near.exit && p.near.door === near.door && p.label === here.label ? p : { feature: here.feature, label: here.label, near }));
      }
    };
    raf = requestAnimationFrame(frame);

    const onKey = (e: KeyboardEvent, down: boolean) => {
      const m: Record<string, Dir> = { ArrowUp: "N", w: "N", ArrowDown: "S", s: "S", ArrowLeft: "W", a: "W", ArrowRight: "E", d: "E" };
      const dir = m[e.key];
      if (!dir) return;
      e.preventDefault();
      heldRef.current = down ? dir : (heldRef.current === dir ? null : heldRef.current);
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [player.id, setSnapshot]);

  if (!exp) return null;

  const curTile = () => { const st = eng.current; return st ? { x: Math.round(st.toX), y: Math.round(st.toY) } : { x: exp.posX, y: exp.posY }; };
  const act = async (fn: (x: number, y: number) => Promise<GameSnapshot | null>) => {
    const { x, y } = curTile();
    const s1 = await syncPos(player.id, x, y);
    if (s1) setSnapshot(s1);
    const s2 = await fn(x, y);
    if (s2) setSnapshot(s2);
  };

  const onLoot = overTile.feature === "LOOT";
  const hpPct = (player.health / player.maxHealth) * 100;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0a08]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" style={{ imageRendering: "pixelated" }} />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-2">
        <div className="panel pointer-events-auto rounded p-2">
          <div className="flex items-center justify-between text-[0.62rem]">
            <span className="title text-[var(--amber)]" title={exp.conditionNote}>{exp.locationIcon} {exp.locationName}</span>
            <span className="text-[var(--ink-dim)]">{exp.conditionIcon} {exp.conditionName} · pack {exp.backpackUsed}/{exp.carryCap}</span>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            <Bar label="HP" pct={hpPct} color={hpPct <= 30 ? "#b13838" : "#c25a3a"} text={`${player.health}`} />
            <Bar label="STA" pct={player.stamina} color="#e0a32e" text={`${player.stamina}`} />
            <Bar label="RAD" pct={player.radiation} color="#8fbf3f" text={`${player.radiation}`} />
          </div>
        </div>
      </div>

      {/* Minimap */}
      <Minimap exp={exp} eng={eng} />

      {/* contextual + ground */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
        {/* D-pad */}
        <Dpad onPress={(d) => (heldRef.current = d)} onRelease={() => (heldRef.current = null)} />

        {/* action stack */}
        <div className="flex max-w-[55%] flex-col items-end gap-1">
          {exp.ground.length > 0 && (
            <div className="panel pointer-events-auto w-full rounded p-1.5 text-[0.66rem]">
              <div className="mb-1 flex items-center justify-between text-[var(--ink-dim)]">
                <span className="title">🔻 ground</span>
                <button className="text-[var(--good)]" onClick={() => act(() => takeAllGround(player.id))}>take all</button>
              </div>
              <div className="max-h-24 overflow-y-auto scroll-thin">
                {exp.ground.map((g) => (
                  <div key={g.idx} className="flex items-center justify-between py-0.5">
                    <span className="truncate">{g.icon} {g.name}{g.quantity > 1 ? ` ×${g.quantity}` : ""}</span>
                    <button className="text-[var(--good)]" onClick={() => act(() => takeGroundItem(player.id, g.idx))}>take</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="pointer-events-auto flex flex-wrap justify-end gap-1">
            {onLoot && <Action label={`🔍 ${exp.searchedHere ? "Searched" : "Search"}`} disabled={exp.searchedHere} onClick={() => act(() => interact(player.id, "search"))} />}
            {overTile.near.exit && <Action label="🚪 Exit" onClick={() => run(async () => { const s = await exitBuilding(player.id); return s; })} />}
            {overTile.near.shelter && <Action label="⌂ Bank loot" hot onClick={() => act(() => returnHome(player.id))} />}
            <Action label="🎒" onClick={() => setShowPack((v) => !v)} />
            <Action label="😴 Rest" onClick={() => act(() => interact(player.id, "rest"))} />
          </div>
        </div>
      </div>

      {/* pack drawer */}
      {showPack && (
        <div className="absolute inset-0 z-20 flex items-end bg-[rgba(0,0,0,0.5)]" onClick={() => setShowPack(false)}>
          <div className="panel m-2 max-h-[60%] w-full overflow-y-auto scroll-thin rounded p-2" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between text-[0.66rem] text-[var(--ink-dim)]">
              <span className="title">Pack {exp.backpackUsed}/{exp.carryCap}</span>
              <button onClick={() => setShowPack(false)}>✕</button>
            </div>
            {exp.backpack.length === 0 && <div className="py-2 text-[0.66rem] text-[var(--ink-dim)]">empty</div>}
            {exp.backpack.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-0.5 text-xs">
                <span className="truncate">{b.icon} {b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ""}</span>
                <span className="flex gap-3">
                  {b.category === "CONSUMABLE" && <button className="text-[var(--amber)]" onClick={() => run(() => useConsumable(player.id, b.id))}>use</button>}
                  <button className="text-[var(--ink-dim)]" onClick={() => act(() => dropItem(player.id, b.id))}>drop</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* battle */}
      {exp.pending?.kind === "enemy" && <Battle />}
    </div>
  );
}

// Bresenham line-of-sight: true if an opaque tile sits strictly between origin
// and target (the target itself, e.g. a wall face, is not counted).
function losBlocked(x0: number, y0: number, x1: number, y1: number, opaque: (x: number, y: number) => boolean): boolean {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let guard = 0; guard < 64; guard++) {
    if (x === x1 && y === y1) return false;
    if (!(x === x0 && y === y0) && opaque(x, y)) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return false;
}

// ── canvas drawing ─────────────────────────────────────────────────────────
function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, st: EngineState, scene: Scene) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const tile = Math.max(18, Math.floor(Math.min(cw, ch) / 11));
  const cx = cw / 2, cy = ch / 2;
  const sx = (tx: number) => Math.round(cx + (tx - st.camX) * tile - tile / 2);
  const sy = (ty: number) => Math.round(cy + (ty - st.camY) * tile - tile / 2);

  ctx.fillStyle = "#0b0a08";
  ctx.fillRect(0, 0, cw, ch);

  const x0 = Math.floor(st.camX - cw / 2 / tile) - 1;
  const x1 = Math.ceil(st.camX + cw / 2 / tile) + 1;
  const y0 = Math.floor(st.camY - ch / 2 / tile) - 1;
  const y1 = Math.ceil(st.camY + ch / 2 / tile) + 1;

  // visibility: a circular radius around the player, with buildings blocking
  // line of sight (you can't see past a wall).
  const pxT = Math.round(st.px), pyT = Math.round(st.py);
  const opaque = (x: number, y: number) => { const k = scene.cellAt(x, y).terrain; return k === "BUILDING" || k === "EDGE"; };
  const visible = (x: number, y: number) => {
    const dx = x - pxT, dy = y - pyT;
    if (dx * dx + dy * dy > VIS_R * VIS_R) return false;
    return !losBlocked(pxT, pyT, x, y, opaque);
  };

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!visible(x, y)) continue; // beyond sight / behind a wall — stays dark
      const c = scene.cellAt(x, y);
      const px = sx(x), py = sy(y);
      ctx.fillStyle = TERRAIN_COLOR[c.terrain];
      ctx.fillRect(px, py, tile, tile);
      // subtle grid + detail
      if (c.terrain === "STREET") { ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fillRect(px, py + tile / 2 - 1, tile, 2); }
      if (c.terrain === "BUILDING") { ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(px, py, tile, 3); }
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.strokeRect(px + 0.5, py + 0.5, tile, tile);
      // feature / structure icons
      const icon = c.terrain === "DOOR" || c.terrain === "SHELTER" || c.terrain === "EXIT" ? c.icon : c.feature === "LOOT" ? c.icon : null;
      if (icon) { ctx.font = `${Math.floor(tile * 0.62)}px serif`; ctx.fillText(icon, px + tile / 2, py + tile / 2 + 1); }
      // soft darkening toward the edge of vision
      const dd = (x - pxT) * (x - pxT) + (y - pyT) * (y - pyT);
      if (dd > (VIS_R - 1.5) * (VIS_R - 1.5)) {
        ctx.fillStyle = `rgba(11,10,8,${Math.min(0.6, (Math.sqrt(dd) - (VIS_R - 1.5)) / 2)})`;
        ctx.fillRect(px, py, tile, tile);
      }
    }
  }

  // enemies (only those within sight)
  ctx.font = `${Math.floor(tile * 0.66)}px serif`;
  for (const e of st.enemies.values()) {
    if (!visible(Math.round(e.x), Math.round(e.y))) continue;
    const px = sx(e.x) + tile / 2, py = sy(e.y) + tile / 2;
    ctx.fillStyle = "rgba(130,40,40,0.5)";
    ctx.beginPath(); ctx.arc(px, py, tile * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(e.icon, px, py + 1);
  }

  // player (placeholder pixel character)
  drawPlayer(ctx, sx(st.px) + tile / 2, sy(st.py) + tile / 2, tile, st.face, st.moving, st.t);
}

function drawPlayer(ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number, face: Dir, moving: boolean, t: number) {
  const u = tile / 16; // pixel unit
  const step = moving && Math.floor(t / 120) % 2 === 0;
  ctx.save();
  ctx.translate(cx, cy);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(0, 6 * u, 5 * u, 2 * u, 0, 0, Math.PI * 2); ctx.fill();
  // legs
  ctx.fillStyle = "#2a2a30";
  ctx.fillRect(-3 * u, 2 * u, 2.4 * u, (step ? 4 : 3) * u);
  ctx.fillRect(0.6 * u, 2 * u, 2.4 * u, (step ? 3 : 4) * u);
  // torso
  ctx.fillStyle = "#c2792f";
  ctx.fillRect(-4 * u, -3 * u, 8 * u, 6 * u);
  // head
  ctx.fillStyle = "#e8c79a";
  ctx.fillRect(-3 * u, -8 * u, 6 * u, 5 * u);
  // facing marker (eyes / pack)
  ctx.fillStyle = "#1a1410";
  if (face === "S") { ctx.fillRect(-2 * u, -6 * u, 1.4 * u, 1.4 * u); ctx.fillRect(0.8 * u, -6 * u, 1.4 * u, 1.4 * u); }
  else if (face === "N") { ctx.fillStyle = "#7a4a20"; ctx.fillRect(-3 * u, -8 * u, 6 * u, 2 * u); }
  else if (face === "E") { ctx.fillRect(1 * u, -6 * u, 1.6 * u, 1.4 * u); }
  else { ctx.fillRect(-2.6 * u, -6 * u, 1.6 * u, 1.4 * u); }
  ctx.restore();
}

// ── small UI bits ────────────────────────────────────────────────────────────
function Bar({ label, pct, color, text }: { label: string; pct: number; color: string; text: string }) {
  return (
    <div>
      <div className="flex justify-between text-[0.5rem] text-[var(--ink-dim)]"><span>{label}</span><span>{text}</span></div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[rgba(0,0,0,0.4)]"><div className="h-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>
    </div>
  );
}

function Action({ label, onClick, disabled, hot }: { label: string; onClick: () => void; disabled?: boolean; hot?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`btn rounded px-2.5 py-2 text-[0.7rem] disabled:opacity-40 ${hot ? "border-[var(--good)] text-[var(--good)]" : ""}`}>{label}</button>
  );
}

function Dpad({ onPress, onRelease }: { onPress: (d: Dir) => void; onRelease: () => void }) {
  const mk = (d: Dir, label: string, cls: string) => (
    <button
      className={`btn flex items-center justify-center rounded text-sm ${cls}`}
      style={{ width: 44, height: 44, touchAction: "none" }}
      onPointerDown={(e) => { e.preventDefault(); onPress(d); }}
      onPointerUp={(e) => { e.preventDefault(); onRelease(); }}
      onPointerLeave={() => onRelease()}
      onPointerCancel={() => onRelease()}
    >{label}</button>
  );
  return (
    <div className="pointer-events-auto grid grid-cols-3 grid-rows-3 gap-1" style={{ width: 140 }}>
      <span /> {mk("N", "↑", "")} <span />
      {mk("W", "←", "")} <span /> {mk("E", "→", "")}
      <span /> {mk("S", "↓", "")} <span />
    </div>
  );
}

function Minimap({ exp, eng }: { exp: GameSnapshot["expedition"]; eng: React.MutableRefObject<EngineState | null> }) {
  if (!exp) return null;
  const N = exp.cityDim;
  const st = eng.current;
  const px = exp.mode === "CITY" ? st?.px ?? exp.posX : exp.shelter.x;
  const py = exp.mode === "CITY" ? st?.py ?? exp.posY : exp.shelter.y;
  const pct = (v: number) => ((v + 0.5) / N) * 100;
  return (
    <div className="absolute right-2 top-24 overflow-hidden rounded border border-[rgba(224,163,46,0.35)]" style={{ width: 84, height: 84, background: "rgba(8,6,5,0.78)" }}>
      <span className="absolute -translate-x-1/2 -translate-y-1/2 text-[8px]" style={{ left: `${pct(exp.shelter.x)}%`, top: `${pct(exp.shelter.y)}%` }}>🏠</span>
      {exp.minimap.map((m) => (
        <span key={`${m.x},${m.y}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[1px]" style={{ left: `${pct(m.x)}%`, top: `${pct(m.y)}%`, width: 4, height: 4, background: "#c9b24a" }} />
      ))}
      <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${pct(px)}%`, top: `${pct(py)}%`, width: 5, height: 5, background: "var(--amber)", boxShadow: "0 0 4px var(--amber)" }} />
    </div>
  );
}
