"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap, GeoJSONSource, Popup, Marker, MarkerOptions } from "maplibre-gl";
import { useGameStore } from "@/store/game";
import type { WorldSnapshot } from "@/lib/snapshot";

// Self-contained dark style — no external tiles or API key required.
const DARK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": "#04060a" } }],
};

function countryPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: s.countries
      .filter((c) => c.isAlive)
      .map((c) => ({
        type: "Feature",
        properties: { iso3: c.iso3, name: c.name, gdp: c.gdp, isPlayer: c.isPlayer ? 1 : 0 },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
  };
}

function territoryPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: s.territories.map((t) => ({
      type: "Feature",
      properties: { id: t.id, name: t.name, morale: t.morale },
      geometry: { type: "Point", coordinates: [t.lng, t.lat] },
    })),
  };
}

function tradeLines(s: WorldSnapshot): GeoJSON.FeatureCollection {
  const coord = new Map(s.countries.map((c) => [c.iso3, [c.lng, c.lat] as [number, number]]));
  return {
    type: "FeatureCollection",
    features: s.tradeRoutes
      .map((r) => {
        const from = coord.get(r.fromIso);
        const to = coord.get(r.toIso);
        if (!from || !to) return null;
        return {
          type: "Feature" as const,
          properties: { good: r.good },
          geometry: { type: "LineString" as const, coordinates: [from, to] },
        };
      })
      .filter(Boolean) as GeoJSON.Feature[],
  };
}

// Our dataset names vs world-atlas country names, where they differ.
const NAME_ALIAS: Record<string, string> = {
  "United States": "United States of America",
  Czechia: "Czech Republic",
  Tanzania: "United Republic of Tanzania",
  Serbia: "Republic of Serbia",
};

function playerNames(name: string): string[] {
  const alias = NAME_ALIAS[name];
  return alias ? [name, alias] : [name];
}

function expandNames(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    out.push(n);
    if (NAME_ALIAS[n]) out.push(NAME_ALIAS[n]);
  }
  return out;
}

// Single-letter label per unit type for the on-map army icons.
const UNIT_LETTER: Record<string, string> = {
  INFANTRY: "I", MECHANIZED: "M", TANK: "T", ARTILLERY: "A", AIR_DEFENSE: "D",
  FIGHTER: "F", BOMBER: "B", DRONE: "R", TRANSPORT_AIR: "T", FRIGATE: "N",
  DESTROYER: "D", SUBMARINE: "S", CARRIER: "C", MISSILE: "!", NUKE: "☢", INTEL: "i",
};

function armyPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  const terr = new Map(s.territories.map((t) => [t.id, [t.lng, t.lat] as [number, number]]));
  return {
    type: "FeatureCollection",
    features: s.armies
      .map((a) => {
        const c = a.locationTerritoryId ? terr.get(a.locationTerritoryId) : undefined;
        if (!c) return null;
        const dominant = [...a.units].sort((x, y) => y.count - x.count)[0]?.type;
        const icon = dominant && UNIT_LETTER[dominant] ? dominant : "UNIT";
        return {
          type: "Feature" as const,
          properties: { name: a.name, strength: Math.round(a.strength), icon },
          geometry: { type: "Point" as const, coordinates: c },
        };
      })
      .filter(Boolean) as GeoJSON.Feature[],
  };
}

// Capitals of countries currently fighting any war — for the conflict markers.
function combatantPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: s.countries
      .filter((c) => c.isAlive && c.combatant && !c.isPlayer)
      .map((c) => ({
        type: "Feature",
        properties: { name: c.name },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
  };
}

// Generate a rounded-chip icon (green, with a letter) as raw RGBA for addImage.
function chipIcon(letter: string, bg: string) {
  const s = 44;
  const cv = document.createElement("canvas");
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext("2d")!;
  const x = 5, y = 5, w = s - 10, h = s - 10, r = 10;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#04060a";
  ctx.stroke();
  ctx.fillStyle = "#04060a";
  ctx.font = "bold 22px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, s / 2, s / 2 + 1);
  return { width: s, height: s, data: new Uint8Array(ctx.getImageData(0, 0, s, s).data.buffer) };
}

// Red conflict marker (filled circle with a white "x").
function warIcon() {
  const s = 32;
  const cv = document.createElement("canvas");
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#ef4444";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fff";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11, 11);
  ctx.lineTo(21, 21);
  ctx.moveTo(21, 11);
  ctx.lineTo(11, 21);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();
  return { width: s, height: s, data: new Uint8Array(ctx.getImageData(0, 0, s, s).data.buffer) };
}

// Pointy-top hexagon ring around a centre (degrees).
function hexRing(cx: number, cy: number, r: number): number[][] {
  const ring: number[][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (30 + 60 * k);
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

// Colour a hex by the current owner of the nearest zone (null = leave uncoloured).
function nearestZoneColor(
  cx: number,
  cy: number,
  zones: WorldSnapshot["allZones"],
  playerIso: string,
  enemy: Set<string>
): string | null {
  let best = Infinity;
  let owner: string | null = null;
  for (const z of zones) {
    const dx = z.lng - cx;
    const dy = z.lat - cy;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      owner = z.ownerIso;
    }
  }
  if (owner === null || best > 25) return null; // >5° from any zone
  if (owner === playerIso) return "#16a34a"; // green
  if (enemy.has(owner)) return "#b91c1c"; // red
  return "#23527a"; // neutral blue
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

export default function WorldMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const nameToIso = useRef<Map<string, string>>(new Map());
  const toRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glRef = useRef<{ Marker: new (opts?: MarkerOptions) => Marker } | null>(null);
  const labelsRef = useRef<Marker[]>([]);
  // Precomputed hex geometry { center, ring } loaded from /hexes.json.
  const hexBaseRef = useRef<{ c: [number, number]; ring: number[][] }[]>([]);
  const snapshotRef = useRef<WorldSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [msg, setMsg] = useState("");
  const snapshot = useGameStore((s) => s.snapshot);
  const selectedCountryIso = useGameStore((s) => s.selectedCountryIso);
  const selectCountry = useGameStore((s) => s.selectCountry);
  const selectTerritory = useGameStore((s) => s.selectTerritory);

  // Rebuild the hex grid colours from the current snapshot's zone ownership.
  const refreshHexes = useCallback(() => {
    const map = mapRef.current;
    const snap = snapshotRef.current;
    const base = hexBaseRef.current;
    if (!map || !snap || !base.length) return;
    const src = map.getSource("hexgrid") as GeoJSONSource | undefined;
    if (!src) return;
    const enemy = new Set(snap.countries.filter((c) => c.atWar).map((c) => c.iso3));
    const playerIso = snap.player.iso3;
    const features: GeoJSON.Feature[] = [];
    for (const h of base) {
      const color = nearestZoneColor(h.c[0], h.c[1], snap.allZones, playerIso, enemy);
      if (!color) continue;
      features.push({
        type: "Feature",
        properties: { color },
        geometry: { type: "Polygon", coordinates: [h.ring] },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !ref.current || mapRef.current) return;
      glRef.current = maplibregl;

      if (!webglAvailable()) {
        setMsg("WebGL is not available in this browser/device.");
        setStatus("error");
        return;
      }

      const map = new maplibregl.Map({
        container: ref.current,
        style: DARK_STYLE,
        center: [10, 30],
        zoom: 1.6,
        attributionControl: false,
        maxZoom: 7,
        minZoom: 1,
        // Don't repeat the world horizontally — avoids vertical seam artifacts.
        renderWorldCopies: false,
        // Smoother edges; reduces stray line artifacts on some mobile GPUs.
        canvasContextAttributes: { antialias: true },
        // Lock orientation: flat, north-up, no rotation or tilt.
        dragRotate: false,
        pitchWithRotate: false,
        rollEnabled: false,
        touchPitch: false,
        bearing: 0,
        pitch: 0,
      });
      // Belt-and-suspenders: kill any remaining rotation gestures.
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation?.();
      mapRef.current = map;
      map.on("error", (e) => {
        const text = (e?.error as Error)?.message ?? String(e);
        console.error("[WorldMap] maplibre error", e?.error ?? e);
        setMsg(text);
        setStatus((s) => (s === "ready" ? s : "error"));
      });

      // MapLibre can init before the flex container has its final size; keep the
      // canvas in sync so the map is never rendered into a zero-height box.
      // Only resize on a real dimension change — resizing on every observer
      // tick can leave streak artifacts in the WebGL framebuffer.
      let lastW = 0;
      let lastH = 0;
      const ro = new ResizeObserver(() => {
        if (!ref.current || !mapRef.current) return;
        const w = ref.current.clientWidth;
        const h = ref.current.clientHeight;
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;
        mapRef.current.resize();
      });
      if (ref.current) ro.observe(ref.current);
      roRef.current = ro;

      // If the load event never fires, surface it rather than spinning forever.
      toRef.current = setTimeout(() => {
        setStatus((s) => {
          if (s === "loading") {
            setMsg("Timed out — the map never finished loading.");
            return "error";
          }
          return s;
        });
      }, 8000);

      // Show country labels only once zoomed in past the strategic view.
      const LABEL_ZOOM = 3;
      const toggleLabels = () => {
        const show = map.getZoom() >= LABEL_ZOOM;
        for (const mk of labelsRef.current) mk.getElement().style.display = show ? "" : "none";
      };
      map.on("zoom", toggleLabels);

      map.on("load", () => {
        if (toRef.current) clearTimeout(toRef.current);
        map.resize();
        setStatus("ready");
        // Register icon images (no font glyphs needed for icon-only symbols).
        for (const [type, letter] of Object.entries(UNIT_LETTER)) {
          if (!map.hasImage(type)) map.addImage(type, chipIcon(letter, "#34d399"), { pixelRatio: 2 });
        }
        if (!map.hasImage("UNIT")) map.addImage("UNIT", chipIcon("•", "#34d399"), { pixelRatio: 2 });
        if (!map.hasImage("war")) map.addImage("war", warIcon(), { pixelRatio: 2 });

        // Real world landmasses; fill colour-codes status (neutral blue base).
        map.addSource("world", { type: "geojson", data: "/world.geojson" });
        map.addLayer({
          id: "world-fill",
          type: "fill",
          source: "world",
          paint: { "fill-color": "#16314d", "fill-opacity": 1 }, // neutral = blue
        });
        map.addLayer({
          id: "enemy-fill",
          type: "fill",
          source: "world",
          paint: { "fill-color": "#b91c1c", "fill-opacity": 0.85 }, // at war = red
          filter: ["==", ["get", "name"], "__none__"],
        });
        map.addLayer({
          id: "player-fill",
          type: "fill",
          source: "world",
          paint: { "fill-color": "#16a34a", "fill-opacity": 0.9 }, // player = green
          filter: ["==", ["get", "name"], "__none__"],
        });
        // Tactical hex grid — coloured by the nearest zone's current owner.
        const emptyFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        map.addSource("hexgrid", { type: "geojson", data: emptyFc });
        map.addLayer({
          id: "hexgrid-fill",
          type: "fill",
          source: "hexgrid",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.55 },
        });
        map.addLayer({
          id: "hexgrid-line",
          type: "line",
          source: "hexgrid",
          paint: { "line-color": "#0a1622", "line-width": 0.3, "line-opacity": 0.5 },
        });

        // Load hex geometry once, then colour it.
        fetch("/hexes.json")
          .then((r) => r.json())
          .then((data: { r: number; hexes: [number, number][] }) => {
            hexBaseRef.current = data.hexes.map((c) => ({ c, ring: hexRing(c[0], c[1], data.r) }));
            refreshHexes();
          })
          .catch((e) => console.error("[WorldMap] hexes load failed", e));

        // Glow outline for the currently selected country.
        map.addLayer({
          id: "selected-glow",
          type: "line",
          source: "world",
          paint: { "line-color": "#fef08a", "line-width": 2.5, "line-blur": 3, "line-opacity": 0.95 },
          filter: ["==", ["get", "name"], "__none__"],
        });
        map.addLayer({
          id: "world-border",
          type: "line",
          source: "world",
          paint: { "line-color": "#22d3ee", "line-width": 0.6, "line-opacity": 0.55 },
        });

        map.addSource("countries", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "country-core",
          type: "circle",
          source: "countries",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "gdp"], 0, 1.2, 27000, 4],
            "circle-color": "#cbe7f5",
            "circle-opacity": 0.6,
          },
        });

        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

        map.addSource("trade", { type: "geojson", data: empty });
        map.addLayer({
          id: "trade",
          type: "line",
          source: "trade",
          paint: { "line-color": "#34d399", "line-width": 1, "line-opacity": 0.5, "line-dasharray": [2, 2] },
        });

        map.addSource("territories", { type: "geojson", data: empty });
        map.addLayer({
          id: "territories",
          type: "circle",
          source: "territories",
          paint: {
            "circle-radius": 5,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#fef08a",
            "circle-stroke-width": 1.5,
          },
        });

        // Conflict markers on countries fighting any war.
        map.addSource("warmarkers", { type: "geojson", data: empty });
        map.addLayer({
          id: "war-markers",
          type: "symbol",
          source: "warmarkers",
          layout: { "icon-image": "war", "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true },
        });

        // Player armies as unit-type icons.
        map.addSource("armies", { type: "geojson", data: empty });
        map.addLayer({
          id: "armies",
          type: "symbol",
          source: "armies",
          layout: {
            "icon-image": ["coalesce", ["get", "icon"], "UNIT"],
            "icon-size": 0.5,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });

        map.on("click", "country-core", (e) => {
          const iso = e.features?.[0]?.properties?.iso3 as string | undefined;
          if (iso) selectCountry(iso);
        });
        map.on("click", "territories", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) selectTerritory(id);
        });
        for (const layer of ["country-core", "territories"]) {
          map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
        }

        // Click any landmass to select that nation (if it's in the game).
        map.on("click", "world-fill", (e) => {
          const name = e.features?.[0]?.properties?.name as string | undefined;
          const iso = name ? nameToIso.current.get(name) : undefined;
          if (iso) selectCountry(iso);
        });

        // Hover label for country names (DOM popup — no font glyphs needed).
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "wd-popup", offset: 8 });
        popupRef.current = popup;
        map.on("mousemove", "world-fill", (e) => {
          const name = e.features?.[0]?.properties?.name as string | undefined;
          if (!name) return;
          map.getCanvas().style.cursor = nameToIso.current.has(name) ? "pointer" : "";
          popup.setLngLat(e.lngLat).setHTML(`<span>${name}</span>`).addTo(map);
        });
        map.on("mouseleave", "world-fill", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });
      });
    })();

    return () => {
      cancelled = true;
      if (toRef.current) clearTimeout(toRef.current);
      roRef.current?.disconnect();
      roRef.current = null;
      for (const mk of labelsRef.current) mk.remove();
      labelsRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [selectCountry, selectTerritory, refreshHexes]);

  // Push snapshot data into the map sources whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !snapshot) return;
    snapshotRef.current = snapshot;

    // Map world-atlas country names back to our iso3 (including aliases).
    const m = new Map<string, string>();
    for (const c of snapshot.countries) {
      m.set(c.name, c.iso3);
      const alias = NAME_ALIAS[c.name];
      if (alias) m.set(alias, c.iso3);
    }
    nameToIso.current = m;

    const apply = () => {
      (map.getSource("countries") as GeoJSONSource | undefined)?.setData(countryPoints(snapshot));
      (map.getSource("territories") as GeoJSONSource | undefined)?.setData(territoryPoints(snapshot));
      (map.getSource("trade") as GeoJSONSource | undefined)?.setData(tradeLines(snapshot));
      (map.getSource("armies") as GeoJSONSource | undefined)?.setData(armyPoints(snapshot));
      (map.getSource("warmarkers") as GeoJSONSource | undefined)?.setData(combatantPoints(snapshot));
      if (map.getLayer("player-fill")) {
        map.setFilter("player-fill", ["in", ["get", "name"], ["literal", playerNames(snapshot.player.name)]]);
      }
      if (map.getLayer("enemy-fill")) {
        const enemyNames = expandNames(snapshot.countries.filter((c) => c.atWar).map((c) => c.name));
        map.setFilter("enemy-fill", ["in", ["get", "name"], ["literal", enemyNames]]);
      }

      // Country name labels (DOM markers) — rebuilt to match the world, shown by zoom.
      const gl = glRef.current;
      if (gl) {
        for (const mk of labelsRef.current) mk.remove();
        const show = map.getZoom() >= 3;
        labelsRef.current = snapshot.countries
          .filter((c) => c.isAlive)
          .map((c) => {
            const el = document.createElement("div");
            el.className = "wd-country-label";
            el.textContent = c.name;
            el.style.display = show ? "" : "none";
            return new gl.Marker({ element: el, anchor: "center" }).setLngLat([c.lng, c.lat]).addTo(map);
          });
      }
      refreshHexes();
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [snapshot, refreshHexes]);

  // Glow the selected country.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !snapshot) return;
    const set = () => {
      if (!map.getLayer("selected-glow")) return;
      const country = snapshot.countries.find((c) => c.iso3 === selectedCountryIso);
      const names = country ? expandNames([country.name]) : ["__none__"];
      map.setFilter("selected-glow", ["in", ["get", "name"], ["literal", names]]);
    };
    if (map.isStyleLoaded()) set();
    else map.once("idle", set);
  }, [selectedCountryIso, snapshot]);

  return (
    <>
      <div ref={ref} className="h-full w-full" />
      {status !== "ready" && (
        <div className="pointer-events-none absolute left-0 top-0 z-10 flex h-full w-full items-center justify-center p-4 text-center text-xs">
          <span className={status === "error" ? "text-[var(--wd-red)]" : "pulse text-cyan-200/60"}>
            {status === "error" ? `Map failed to load: ${msg}` : "Loading map…"}
          </span>
        </div>
      )}
    </>
  );
}
