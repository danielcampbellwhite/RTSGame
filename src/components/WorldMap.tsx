"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap, GeoJSONSource, Popup, Marker, MarkerOptions } from "maplibre-gl";
import { Delaunay } from "d3-delaunay";
import polygonClipping, { type Polygon as PcPolygon, type MultiPolygon as PcMultiPolygon } from "polygon-clipping";
import { useGameStore } from "@/store/game";
import type { WorldSnapshot } from "@/lib/snapshot";

const DARK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": "#04060a" } }],
};

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

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}

// Build a polygon-clipping MultiPolygon for a country from its GeoJSON features.
function countryMultiPolygon(features: GeoJSON.Feature[]): PcMultiPolygon {
  const mp: PcMultiPolygon = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === "Polygon") mp.push(g.coordinates as PcPolygon);
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) mp.push(poly as PcPolygon);
  }
  return mp;
}

// Partition each country's area among its zone points (Voronoi, clipped to the
// border). Returns one MultiPolygon feature per zone tagged with its id.
function computeRegions(
  worldFeatures: GeoJSON.Feature[],
  snap: WorldSnapshot,
  nameToIso: Map<string, string>
): GeoJSON.Feature[] {
  const byIso = new Map<string, GeoJSON.Feature[]>();
  for (const f of worldFeatures) {
    const iso = nameToIso.get((f.properties?.name as string) ?? "");
    if (!iso) continue;
    (byIso.get(iso) ?? byIso.set(iso, []).get(iso)!).push(f);
  }
  const zonesByHome = new Map<string, WorldSnapshot["allZones"]>();
  for (const z of snap.allZones) (zonesByHome.get(z.homeIso) ?? zonesByHome.set(z.homeIso, []).get(z.homeIso)!).push(z);

  const out: GeoJSON.Feature[] = [];
  for (const [iso, features] of byIso) {
    const zones = zonesByHome.get(iso);
    if (!zones?.length) continue;
    const mp = countryMultiPolygon(features);
    if (!mp.length) continue;

    if (zones.length === 1) {
      out.push({ type: "Feature", properties: { zoneId: zones[0].id }, geometry: { type: "MultiPolygon", coordinates: mp as unknown as GeoJSON.Position[][][] } });
      continue;
    }

    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const poly of mp) for (const ring of poly) for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pts = zones.map((z) => [z.lng, z.lat] as [number, number]);
    const vor = Delaunay.from(pts).voronoi([minX - 1, minY - 1, maxX + 1, maxY + 1]);
    for (let i = 0; i < zones.length; i++) {
      const cell = vor.cellPolygon(i);
      if (!cell) continue;
      try {
        const clipped = polygonClipping.intersection([cell as unknown as PcPolygon[0]], mp);
        if (!clipped.length) continue;
        out.push({
          type: "Feature",
          properties: { zoneId: zones[i].id },
          geometry: { type: "MultiPolygon", coordinates: clipped as unknown as GeoJSON.Position[][][] },
        });
      } catch {
        /* skip degenerate cell */
      }
    }
  }
  return out;
}

function zoneColor(ownerIso: string | undefined, playerIso: string, enemy: Set<string>): string {
  if (!ownerIso) return "#1b3a55";
  if (ownerIso === playerIso) return "#16a34a";
  if (enemy.has(ownerIso)) return "#b91c1c";
  return "#2a5f86";
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
  const worldFeaturesRef = useRef<GeoJSON.Feature[]>([]);
  const regionsRef = useRef<GeoJSON.Feature[]>([]);
  const regionsGameRef = useRef<string | null>(null);
  const snapshotRef = useRef<WorldSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [msg, setMsg] = useState("");
  const snapshot = useGameStore((s) => s.snapshot);
  const selectedTerritoryId = useGameStore((s) => s.selectedTerritoryId);
  const highlightedZoneId = useGameStore((s) => s.highlightedZoneId);

  // Compute (once per game) the zone regions, then colour them by current owner.
  const refreshZones = useCallback(() => {
    const map = mapRef.current;
    const snap = snapshotRef.current;
    if (!map || !snap || !worldFeaturesRef.current.length) return;
    const src = map.getSource("zoneregions") as GeoJSONSource | undefined;
    if (!src) return;

    if (regionsGameRef.current !== snap.gameId || !regionsRef.current.length) {
      regionsRef.current = computeRegions(worldFeaturesRef.current, snap, nameToIso.current);
      regionsGameRef.current = snap.gameId;
    }

    const owner = new Map(snap.allZones.map((z) => [z.id, z.ownerIso]));
    const enemy = new Set(snap.countries.filter((c) => c.atWar).map((c) => c.iso3));
    const playerIso = snap.player.iso3;
    const features = regionsRef.current.map((f) => ({
      ...f,
      properties: { zoneId: f.properties!.zoneId, color: zoneColor(owner.get(f.properties!.zoneId as string), playerIso, enemy) },
    }));
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

      // Two-stage tap: first tap just highlights a zone, second opens management.
      const onZone = (zoneId?: string) => {
        if (!zoneId) return;
        const st = useGameStore.getState();
        if (st.highlightedZoneId === zoneId) {
          st.selectTerritory(zoneId);
        } else {
          st.highlightZone(zoneId);
          st.selectTerritory(null);
        }
      };

      map.on("load", () => {
        if (toRef.current) clearTimeout(toRef.current);
        map.resize();
        setStatus("ready");

        for (const [type, letter] of Object.entries(UNIT_LETTER)) {
          if (!map.hasImage(type)) map.addImage(type, unitChip(letter, "#34d399"), { pixelRatio: 2 });
        }
        if (!map.hasImage("UNIT")) map.addImage("UNIT", unitChip("•", "#34d399"), { pixelRatio: 2 });
        if (!map.hasImage("war")) map.addImage("war", warIcon(), { pixelRatio: 2 });
        for (const k of ZONE_KINDS) if (!map.hasImage(`zone-${k}`)) map.addImage(`zone-${k}`, zoneIcon(k), { pixelRatio: 2 });

        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

        map.addSource("world", { type: "geojson", data: "/world.geojson" });
        map.addLayer({ id: "world-fill", type: "fill", source: "world", paint: { "fill-color": "#0f2236", "fill-opacity": 1 } });

        // Zone regions (Voronoi cells clipped to the country).
        map.addSource("zoneregions", { type: "geojson", data: empty });
        map.addLayer({ id: "zoneregions-fill", type: "fill", source: "zoneregions", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.75 } });
        map.addLayer({ id: "zoneregions-line", type: "line", source: "zoneregions", paint: { "line-color": "#06121e", "line-width": 0.6, "line-opacity": 0.6 } });
        map.addLayer({
          id: "zone-selected",
          type: "line",
          source: "zoneregions",
          paint: { "line-color": "#fde047", "line-width": 2.2, "line-opacity": 0.95 },
          filter: ["==", ["get", "zoneId"], "__none__"],
        });

        map.addLayer({ id: "world-border", type: "line", source: "world", paint: { "line-color": "#22d3ee", "line-width": 0.7, "line-opacity": 0.5 } });

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

        fetch("/world.geojson")
          .then((r) => r.json())
          .then((data: GeoJSON.FeatureCollection) => {
            worldFeaturesRef.current = data.features;
            refreshZones();
          })
          .catch((e) => console.error("[WorldMap] world geojson load failed", e));

        for (const layer of ["zoneregions-fill", "zone-icons"]) {
          map.on("click", layer, (e) => onZone((e.features?.[0]?.properties?.zoneId || e.features?.[0]?.properties?.id) as string | undefined));
          map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
        }

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
  }, [refreshZones]);

  // Push snapshot data into the map whenever it changes.
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
      refreshZones();
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [snapshot, refreshZones]);

  // Highlight the highlighted/selected zone + glow its country.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !snapshot) return;
    const set = () => {
      if (map.getLayer("zone-selected")) {
        const ids = [highlightedZoneId, selectedTerritoryId].filter(Boolean) as string[];
        map.setFilter("zone-selected", ["in", ["get", "zoneId"], ["literal", ids.length ? ids : ["__none__"]]]);
      }
    };
    if (map.isStyleLoaded()) set();
    else map.once("idle", set);
  }, [highlightedZoneId, selectedTerritoryId, snapshot]);

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
