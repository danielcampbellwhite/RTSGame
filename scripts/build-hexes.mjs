// Generate a world hex grid for the tactical map. Each hex whose centre falls on
// land (inside any country polygon) is kept; at runtime the client colours each
// hex by the current owner of the nearest zone, so captures redraw the front.
// Run once: `node scripts/build-hexes.mjs` -> public/hexes.json
import { readFileSync, writeFileSync, statSync } from "node:fs";

const world = JSON.parse(readFileSync("public/world.geojson", "utf8"));

// Precompute per-feature bounding boxes for a fast reject test.
const feats = world.features.map((f) => {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const eachRing = (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) eachRing(ring);
  return { polys, bbox: [minX, minY, maxX, maxY] };
});

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function onLand(x, y) {
  for (const f of feats) {
    const [minX, minY, maxX, maxY] = f.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    for (const poly of f.polys) {
      if (!ringContains(poly[0], x, y)) continue; // outer ring
      let inHole = false;
      for (let h = 1; h < poly.length; h++) if (ringContains(poly[h], x, y)) inHole = true;
      if (!inHole) return true;
    }
  }
  return false;
}

// Pointy-top hex lattice over the inhabited latitudes.
const R = 0.85; // circumradius in degrees
const dx = Math.sqrt(3) * R;
const dy = 1.5 * R;
const LNG0 = -169, LNG1 = 190, LAT0 = -56, LAT1 = 78;

const hexes = [];
let row = 0;
for (let lat = LAT0; lat <= LAT1; lat += dy, row++) {
  const offset = row % 2 ? dx / 2 : 0;
  for (let lng = LNG0 + offset; lng <= LNG1; lng += dx) {
    if (onLand(lng, lat)) hexes.push([Math.round(lng * 100) / 100, Math.round(lat * 100) / 100]);
  }
}

writeFileSync("public/hexes.json", JSON.stringify({ r: R, hexes }));
const kb = (statSync("public/hexes.json").size / 1024).toFixed(0);
console.log(`Wrote public/hexes.json — ${hexes.length} land hexes, ${kb} KB`);
