// Generate a world hex grid for the tactical map. Each land hex records which
// country it sits in; at runtime the client groups hexes into per-country zone
// "blocks" (nearest zone of that country) and colours them by current owner, so
// captures redraw the front. Run: `node scripts/build-hexes.mjs` -> public/hexes.json
import { readFileSync, writeFileSync, statSync } from "node:fs";

const world = JSON.parse(readFileSync("public/world.geojson", "utf8"));

const feats = world.features.map((f) => {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { name: f.properties?.name ?? "", polys, bbox: [minX, minY, maxX, maxY] };
});

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Country name containing (x,y), or null if open sea.
function countryAt(x, y) {
  for (const f of feats) {
    const [minX, minY, maxX, maxY] = f.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    for (const poly of f.polys) {
      if (!ringContains(poly[0], x, y)) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++) if (ringContains(poly[h], x, y)) inHole = true;
      if (!inHole) return f.name;
    }
  }
  return null;
}

const R = 0.85;
const dx = Math.sqrt(3) * R;
const dy = 1.5 * R;
const LNG0 = -169, LNG1 = 190, LAT0 = -56, LAT1 = 78;

const names = [];
const nameIdx = new Map();
const hexes = [];
let row = 0;
for (let lat = LAT0; lat <= LAT1; lat += dy, row++) {
  const offset = row % 2 ? dx / 2 : 0;
  for (let lng = LNG0 + offset; lng <= LNG1; lng += dx) {
    const name = countryAt(lng, lat);
    if (name === null) continue;
    let idx = nameIdx.get(name);
    if (idx === undefined) {
      idx = names.length;
      names.push(name);
      nameIdx.set(name, idx);
    }
    hexes.push([Math.round(lng * 100) / 100, Math.round(lat * 100) / 100, idx]);
  }
}

writeFileSync("public/hexes.json", JSON.stringify({ r: R, names, hexes }));
const kb = (statSync("public/hexes.json").size / 1024).toFixed(0);
console.log(`Wrote public/hexes.json — ${hexes.length} land hexes across ${names.length} countries, ${kb} KB`);
