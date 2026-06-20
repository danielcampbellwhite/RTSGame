// Build a static world-countries GeoJSON for the map from the world-atlas
// TopoJSON dataset. Run once with `node scripts/build-geo.mjs`; output is
// committed at public/world.geojson and served as a MapLibre source.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { feature } from "topojson-client";

const topo = JSON.parse(readFileSync("node_modules/world-atlas/countries-110m.json", "utf8"));
const fc = feature(topo, topo.objects.countries);

// Keep only id + name in properties to slim the payload.
for (const f of fc.features) {
  f.properties = { name: f.properties?.name ?? "", id: f.id ?? null };
}

mkdirSync("public", { recursive: true });
writeFileSync("public/world.geojson", JSON.stringify(fc));
const kb = (statSync("public/world.geojson").size / 1024).toFixed(0);
console.log(`Wrote public/world.geojson — ${fc.features.length} countries, ${kb} KB`);
