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

// Our dataset names vs world-atlas country names, where they differ.
const NAME_ALIAS: Record<string, string> = {
  "United States": "United States of America",
  Czechia: "Czech Republic",
  Tanzania: "United Republic of Tanzania",
  Serbia: "Republic of Serbia",
};

function expandNames(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    out.push(n);
    if (NAME_ALIAS[n]) out.push(NAME_ALIAS[n]);
  }
  return out;
}

const UNIT_LETTER: Record<string, string> = {
  INFANTRY: "I", MECHANIZED: "M", TANK: "T", ARTILLERY: "A", AIR_DEFENSE: "D",
  FIGHTER: "F", BOMBER: "B", DRONE: "R", TRANSPORT_AIR: "T", FRIGATE: "N",
  DESTROYER: "D", SUBMARINE: "S", CARRIER: "C", MISSILE: "!", NUKE: "☢", INTEL: "i",
};

const ZONE_KINDS = ["CAPITAL", "MAJOR_CITY", "INDUSTRIAL", "PORT", "MILITARY", "RURAL"];

function tradeLines(s: WorldSnapshot): GeoJSON.FeatureCollection {
  const coord = new Map(s.countries.map((c) => [c.iso3, [c.lng, c.lat] as [number, number]]));
  return {
    type: "FeatureCollection",
    features: s.tradeRoutes
      .map((r) => {
        const from = coord.get(r.fromIso);
        const to = coord.get(r.toIso);
        if (!from || !to) return null;
        return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [from, to] } };
      })
      .filter(Boolean) as GeoJSON.Feature[],
  };
}

function armyPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  const coord = new Map(s.allZones.map((z) => [z.id, [z.lng, z.lat] as [number, number]]));
  return {
    type: "FeatureCollection",
    features: s.armies
      .map((a) => {
        const c = a.locationTerritoryId ? coord.get(a.locationTerritoryId) : undefined;
        if (!c) return null;
        const dominant = [...a.units].sort((x, y) => y.count - x.count)[0]?.type;
        const icon = dominant && UNIT_LETTER[dominant] ? dominant : "UNIT";
        return { type: "Feature" as const, properties: { icon }, geometry: { type: "Point" as const, coordinates: c } };
      })
      .filter(Boolean) as GeoJSON.Feature[],
  };
}

function combatantPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: s.countries
      .filter((c) => c.isAlive && c.combatant && !c.isPlayer)
      .map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [c.lng, c.lat] } })),
  };
}

function zonePoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: s.allZones.map((z) => ({
      type: "Feature",
      properties: { id: z.id, kind: z.kind },
      geometry: { type: "Point", coordinates: [z.lng, z.lat] },
    })),
  };
}

// ── Canvas icon generators (no font glyphs required) ──────────────────────
function unitChip(letter: string, bg: string) {
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

// Per-zone-type icon (distinct shape, so a country reads as labelled blocks).
function zoneIcon(kind: string) {
  const s = 30;
  const cv = document.createElement("canvas");
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext("2d")!;
  const cx = s / 2, cy = s / 2;
  ctx.fillStyle = "#eef9ff";
  ctx.strokeStyle = "#04060a";
  ctx.lineWidth = 2;
  const draw = () => {
    ctx.fill();
    ctx.stroke();
  };
  if (kind === "CAPITAL") {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 11 : 4.5;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const fn = i === 0 ? "moveTo" : "lineTo";
      ctx[fn](cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
    draw();
  } else if (kind === "INDUSTRIAL") {
    ctx.beginPath();
    ctx.rect(cx - 8, cy - 8, 16, 16);
    draw();
  } else if (kind === "PORT") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx + 9, cy + 8);
    ctx.lineTo(cx - 9, cy + 8);
    ctx.closePath();
    draw();
  } else if (kind === "MILITARY") {
    ctx.beginPath();
    ctx.rect(cx - 3, cy - 9, 6, 18);
    ctx.rect(cx - 9, cy - 3, 18, 6);
    draw();
  } else if (kind === "MAJOR_CITY") {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    draw();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    draw();
  }
  return { width: s, height: s, data: new Uint8Array(ctx.getImageData(0, 0, s, s).data.buffer) };
}

function hexRing(cx: number, cy: number, r: number): number[][] {
  const ring: number[][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (30 + 60 * k);
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}

type HexBase = { c: [number, number]; ring: number[][]; name: string; zoneId: string | null };

export default function WorldMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const nameToIso = useRef<Map<string, string>>(new Map());
  const toRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glRef = useRef<{ Marker: new (opts?: MarkerOptions) => Marker } | null>(null);
  const labelsRef = useRef<Marker[]>([]);
  const hexBaseRef = useRef<HexBase[]>([]);
  const assignedGameRef = useRef<string | null>(null);
  const snapshotRef = useRef<WorldSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [msg, setMsg] = useState("");
  const snapshot = useGameStore((s) => s.snapshot);
  const selectedCountryIso = useGameStore((s) => s.selectedCountryIso);
  const selectedTerritoryId = useGameStore((s) => s.selectedTerritoryId);
  const selectCountry = useGameStore((s) => s.selectCountry);
  const selectTerritory = useGameStore((s) => s.selectTerritory);

  // Assign each hex to its country's nearest zone (a "block"), then colour the
  // grid by each zone's current owner so captures redraw the front line.
  const refreshHexes = useCallback(() => {
    const map = mapRef.current;
    const snap = snapshotRef.current;
    const base = hexBaseRef.current;
    if (!map || !snap || !base.length) return;
    const src = map.getSource("hexgrid") as GeoJSONSource | undefined;
    if (!src) return;

    if (assignedGameRef.current !== snap.gameId) {
      const byHome = new Map<string, WorldSnapshot["allZones"]>();
      for (const z of snap.allZones) {
        const arr = byHome.get(z.homeIso) ?? [];
        arr.push(z);
        byHome.set(z.homeIso, arr);
      }
      for (const h of base) {
        const iso = nameToIso.current.get(h.name);
        const zs = iso ? byHome.get(iso) : undefined;
        if (!zs || !zs.length) {
          h.zoneId = null;
          continue;
        }
        let bd = Infinity;
        let bz: string | null = null;
        for (const z of zs) {
          const dx = z.lng - h.c[0];
          const dy = z.lat - h.c[1];
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            bz = z.id;
          }
        }
        h.zoneId = bz;
      }
      assignedGameRef.current = snap.gameId;
    }

    const zonesById = new Map(snap.allZones.map((z) => [z.id, z]));
    const enemy = new Set(snap.countries.filter((c) => c.atWar).map((c) => c.iso3));
    const playerIso = snap.player.iso3;
    const features: GeoJSON.Feature[] = base.map((h) => {
      const zone = h.zoneId ? zonesById.get(h.zoneId) : undefined;
      let color = "#1b3a55";
      if (zone) color = zone.ownerIso === playerIso ? "#16a34a" : enemy.has(zone.ownerIso) ? "#b91c1c" : "#2a5f86";
      return {
        type: "Feature",
        properties: { color, zoneId: h.zoneId ?? "" },
        geometry: { type: "Polygon", coordinates: [h.ring] },
      };
    });
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
        renderWorldCopies: false,
        canvasContextAttributes: { antialias: true },
        dragRotate: false,
        pitchWithRotate: false,
        rollEnabled: false,
        touchPitch: false,
        bearing: 0,
        pitch: 0,
      });
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

      toRef.current = setTimeout(() => {
        setStatus((s) => {
          if (s === "loading") {
            setMsg("Timed out — the map never finished loading.");
            return "error";
          }
          return s;
        });
      }, 8000);

      const LABEL_ZOOM = 3;
      map.on("zoom", () => {
        const show = map.getZoom() >= LABEL_ZOOM;
        for (const mk of labelsRef.current) mk.getElement().style.display = show ? "" : "none";
      });

      const selectZone = (zoneId?: string) => {
        if (!zoneId) return;
        selectTerritory(zoneId);
        const z = snapshotRef.current?.allZones.find((x) => x.id === zoneId);
        if (z) selectCountry(z.ownerIso);
      };

      map.on("load", () => {
        if (toRef.current) clearTimeout(toRef.current);
        map.resize();
        setStatus("ready");

        // Icon images.
        for (const [type, letter] of Object.entries(UNIT_LETTER)) {
          if (!map.hasImage(type)) map.addImage(type, unitChip(letter, "#34d399"), { pixelRatio: 2 });
        }
        if (!map.hasImage("UNIT")) map.addImage("UNIT", unitChip("•", "#34d399"), { pixelRatio: 2 });
        if (!map.hasImage("war")) map.addImage("war", warIcon(), { pixelRatio: 2 });
        for (const k of ZONE_KINDS) if (!map.hasImage(`zone-${k}`)) map.addImage(`zone-${k}`, zoneIcon(k), { pixelRatio: 2 });

        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

        // Base land (shows through hex gaps) + country outlines.
        map.addSource("world", { type: "geojson", data: "/world.geojson" });
        map.addLayer({ id: "world-fill", type: "fill", source: "world", paint: { "fill-color": "#0f2236", "fill-opacity": 1 } });

        // Tactical hex blocks — coloured by each block's owning zone.
        map.addSource("hexgrid", { type: "geojson", data: empty });
        map.addLayer({ id: "hexgrid-fill", type: "fill", source: "hexgrid", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.7 } });
        map.addLayer({ id: "hexgrid-line", type: "line", source: "hexgrid", paint: { "line-color": "#0a1622", "line-width": 0.3, "line-opacity": 0.5 } });
        map.addLayer({
          id: "hexgrid-selected",
          type: "line",
          source: "hexgrid",
          paint: { "line-color": "#fef08a", "line-width": 1.6, "line-opacity": 0.95 },
          filter: ["==", ["get", "zoneId"], "__none__"],
        });

        map.addLayer({
          id: "selected-glow",
          type: "line",
          source: "world",
          paint: { "line-color": "#fef08a", "line-width": 2.5, "line-blur": 3, "line-opacity": 0.9 },
          filter: ["==", ["get", "name"], "__none__"],
        });
        map.addLayer({ id: "world-border", type: "line", source: "world", paint: { "line-color": "#22d3ee", "line-width": 0.6, "line-opacity": 0.55 } });

        // Zone type icons (one per block).
        map.addSource("zones", { type: "geojson", data: empty });
        map.addLayer({
          id: "zone-icons",
          type: "symbol",
          source: "zones",
          layout: { "icon-image": ["concat", "zone-", ["get", "kind"]], "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true },
        });

        map.addSource("trade", { type: "geojson", data: empty });
        map.addLayer({ id: "trade", type: "line", source: "trade", paint: { "line-color": "#34d399", "line-width": 1, "line-opacity": 0.5, "line-dasharray": [2, 2] } });

        map.addSource("warmarkers", { type: "geojson", data: empty });
        map.addLayer({ id: "war-markers", type: "symbol", source: "warmarkers", layout: { "icon-image": "war", "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true } });

        map.addSource("armies", { type: "geojson", data: empty });
        map.addLayer({
          id: "armies",
          type: "symbol",
          source: "armies",
          layout: { "icon-image": ["coalesce", ["get", "icon"], "UNIT"], "icon-size": 0.55, "icon-allow-overlap": true, "icon-ignore-placement": true },
        });

        // Load hex geometry once, tagged with each hex's country, then colour it.
        fetch("/hexes.json")
          .then((r) => r.json())
          .then((data: { r: number; names: string[]; hexes: [number, number, number][] }) => {
            hexBaseRef.current = data.hexes.map(([lng, lat, idx]) => ({
              c: [lng, lat],
              ring: hexRing(lng, lat, data.r),
              name: data.names[idx],
              zoneId: null,
            }));
            assignedGameRef.current = null;
            refreshHexes();
          })
          .catch((e) => console.error("[WorldMap] hexes load failed", e));

        for (const layer of ["hexgrid-fill", "zone-icons"]) {
          map.on("click", layer, (e) => selectZone(e.features?.[0]?.properties?.zoneId || e.features?.[0]?.properties?.id));
          map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
        }

        // Hover label for country names.
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "wd-popup", offset: 8 });
        popupRef.current = popup;
        map.on("mousemove", "world-fill", (e) => {
          const name = e.features?.[0]?.properties?.name as string | undefined;
          if (!name) return;
          popup.setLngLat(e.lngLat).setHTML(`<span>${name}</span>`).addTo(map);
        });
        map.on("mouseleave", "world-fill", () => popup.remove());
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

    const m = new Map<string, string>();
    for (const c of snapshot.countries) {
      m.set(c.name, c.iso3);
      const alias = NAME_ALIAS[c.name];
      if (alias) m.set(alias, c.iso3);
    }
    nameToIso.current = m;

    const apply = () => {
      (map.getSource("zones") as GeoJSONSource | undefined)?.setData(zonePoints(snapshot));
      (map.getSource("trade") as GeoJSONSource | undefined)?.setData(tradeLines(snapshot));
      (map.getSource("armies") as GeoJSONSource | undefined)?.setData(armyPoints(snapshot));
      (map.getSource("warmarkers") as GeoJSONSource | undefined)?.setData(combatantPoints(snapshot));

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

  // Highlight the selected zone's hexes + glow its country.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !snapshot) return;
    const set = () => {
      if (map.getLayer("hexgrid-selected")) {
        map.setFilter("hexgrid-selected", ["==", ["get", "zoneId"], selectedTerritoryId ?? "__none__"]);
      }
      if (map.getLayer("selected-glow")) {
        const country = snapshot.countries.find((c) => c.iso3 === selectedCountryIso);
        map.setFilter("selected-glow", ["in", ["get", "name"], ["literal", country ? expandNames([country.name]) : ["__none__"]]]);
      }
    };
    if (map.isStyleLoaded()) set();
    else map.once("idle", set);
  }, [selectedTerritoryId, selectedCountryIso, snapshot]);

  return (
    <>
      <div ref={ref} className="h-full w-full" />
      {status !== "ready" && (
        <div className="pointer-events-none absolute left-0 top-0 z-10 flex h-full w-full items-center justify-center p-4 text-center text-xs">
          <span className={status === "error" ? "text-[var(--wd-red)]" : "pulse text-cyan-200/80"}>
            {status === "error" ? `Map failed to load: ${msg}` : "Loading map…"}
          </span>
        </div>
      )}
    </>
  );
}
