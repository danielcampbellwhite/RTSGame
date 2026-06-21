// Build a static world-countries GeoJSON for the map from the world-atlas
// TopoJSON dataset. Run once with `node scripts/build-geo.mjs`; output is
// committed at public/world.geojson and served as a MapLibre source.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { feature } from "topojson-client";

const topo = JSON.parse(readFileSync("node_modules/world-atlas/countries-110m.json", "utf8"));
const fc = feature(topo, topo.objects.countries);

// Make a ring's longitudes continuous so polygons that cross the ±180° meridian
// (Alaska, Russia, Fiji…) don't draw a stray line stretching across the whole
// map. Each point is shifted to within 180° of the previous one.
function unwrapRing(ring) {
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) ring[i][0] -= 360;
    else if (d < -180) ring[i][0] += 360;
  }
}
function unwrap(geom) {
  if (!geom) return;
  if (geom.type === "Polygon") geom.coordinates.forEach(unwrapRing);
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach((p) => p.forEach(unwrapRing));
}

// Drop Antarctica (not playable, and its base edge draws a horizontal artifact).
fc.features = fc.features.filter((f) => (f.properties?.name ?? "") !== "Antarctica");

for (const f of fc.features) {
  f.properties = { name: f.properties?.name ?? "", id: f.id ?? null };
  unwrap(f.geometry);
}

mkdirSync("public", { recursive: true });
writeFileSync("public/world.geojson", JSON.stringify(fc));
const kb = (statSync("public/world.geojson").size / 1024).toFixed(0);
console.log(`Wrote public/world.geojson — ${fc.features.length} countries, ${kb} KB`);
