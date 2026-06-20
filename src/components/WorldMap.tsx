"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Map as MlMap, GeoJSONSource, Popup } from "maplibre-gl";
import { useGameStore } from "@/store/game";
import type { WorldSnapshot } from "@/lib/snapshot";

// Self-contained dark style — no external tiles or API key required.
const DARK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": "#04060a" } }],
};

function graticule(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lng = -180; lng <= 180; lng += 20) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[lng, -85], [lng, 85]] },
    });
  }
  for (let lat = -80; lat <= 80; lat += 20) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] },
    });
  }
  return { type: "FeatureCollection", features };
}

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

function warPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: s.warTargets.map((w) => ({
      type: "Feature",
      properties: { name: w.territoryName },
      geometry: { type: "Point", coordinates: [w.lng, w.lat] },
    })),
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

function armyPoints(s: WorldSnapshot): GeoJSON.FeatureCollection {
  const terr = new Map(s.territories.map((t) => [t.id, [t.lng, t.lat] as [number, number]]));
  return {
    type: "FeatureCollection",
    features: s.armies
      .map((a) => {
        const c = a.locationTerritoryId ? terr.get(a.locationTerritoryId) : undefined;
        if (!c) return null;
        return {
          type: "Feature" as const,
          properties: { name: a.name, strength: a.strength },
          geometry: { type: "Point" as const, coordinates: c },
        };
      })
      .filter(Boolean) as GeoJSON.Feature[],
  };
}

export default function WorldMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const nameToIso = useRef<Map<string, string>>(new Map());
  const snapshot = useGameStore((s) => s.snapshot);
  const selectCountry = useGameStore((s) => s.selectCountry);
  const selectTerritory = useGameStore((s) => s.selectTerritory);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !ref.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: ref.current,
        style: DARK_STYLE,
        center: [10, 30],
        zoom: 1.6,
        attributionControl: false,
        maxZoom: 7,
        minZoom: 1,
      });
      mapRef.current = map;
      map.on("error", (e) => console.error("[WorldMap] maplibre error", e?.error ?? e));

      // MapLibre can init before the flex container has its final size; keep the
      // canvas in sync so the map is never rendered into a zero-height box.
      const ro = new ResizeObserver(() => mapRef.current?.resize());
      if (ref.current) ro.observe(ref.current);
      roRef.current = ro;

      map.on("load", () => {
        map.resize();
        // Real world landmasses + neon country borders (token-free static GeoJSON).
        map.addSource("world", { type: "geojson", data: "/world.geojson" });
        map.addLayer({
          id: "world-fill",
          type: "fill",
          source: "world",
          paint: { "fill-color": "#13283d", "fill-opacity": 1 },
        });
        map.addLayer({
          id: "player-fill",
          type: "fill",
          source: "world",
          paint: { "fill-color": "#f0f", "fill-opacity": 0.22 },
          filter: ["==", ["get", "name"], "__none__"],
        });
        map.addLayer({
          id: "world-border",
          type: "line",
          source: "world",
          paint: { "line-color": "#22d3ee", "line-width": 0.8, "line-opacity": 0.7 },
        });

        map.addSource("grid", { type: "geojson", data: graticule() });
        map.addLayer({
          id: "grid",
          type: "line",
          source: "grid",
          paint: { "line-color": "#22d3ee", "line-width": 0.4, "line-opacity": 0.12 },
        });

        map.addSource("countries", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "country-glow",
          type: "circle",
          source: "countries",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "gdp"], 0, 4, 27000, 22],
            "circle-color": ["case", ["==", ["get", "isPlayer"], 1], "#f0f", "#22d3ee"],
            "circle-blur": 1,
            "circle-opacity": 0.35,
          },
        });
        map.addLayer({
          id: "country-core",
          type: "circle",
          source: "countries",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "gdp"], 0, 1.5, 27000, 6],
            "circle-color": ["case", ["==", ["get", "isPlayer"], 1], "#ff66ff", "#7fe9f7"],
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
            "circle-stroke-color": "#f0f",
            "circle-stroke-width": 1.5,
          },
        });

        map.addSource("armies", { type: "geojson", data: empty });
        map.addLayer({
          id: "armies",
          type: "circle",
          source: "armies",
          paint: { "circle-radius": 3.5, "circle-color": "#34d399", "circle-stroke-color": "#04060a", "circle-stroke-width": 1 },
        });

        map.addSource("wars", { type: "geojson", data: empty });
        map.addLayer({
          id: "wars-glow",
          type: "circle",
          source: "wars",
          paint: { "circle-radius": 10, "circle-color": "#ef4444", "circle-blur": 1, "circle-opacity": 0.5 },
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
      roRef.current?.disconnect();
      roRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [selectCountry, selectTerritory]);

  // Push snapshot data into the map sources whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !snapshot) return;

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
      (map.getSource("wars") as GeoJSONSource | undefined)?.setData(warPoints(snapshot));
      if (map.getLayer("player-fill")) {
        map.setFilter("player-fill", ["in", ["get", "name"], ["literal", playerNames(snapshot.player.name)]]);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [snapshot]);

  return <div ref={ref} className="absolute inset-0" />;
}
