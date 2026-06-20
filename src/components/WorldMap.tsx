"use client";

import { useEffect, useRef } from "react";
import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
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

export default function WorldMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
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

      map.on("load", () => {
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

        map.addSource("territories", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
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
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [selectCountry, selectTerritory]);

  // Push snapshot data into the map sources whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !snapshot) return;
    const apply = () => {
      (map.getSource("countries") as GeoJSONSource | undefined)?.setData(countryPoints(snapshot));
      (map.getSource("territories") as GeoJSONSource | undefined)?.setData(territoryPoints(snapshot));
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [snapshot]);

  return <div ref={ref} className="absolute inset-0" />;
}
