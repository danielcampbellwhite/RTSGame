// Server-side land/water test from the bundled world polygons. Used to forbid
// armies from walking across open sea (they need naval transport instead).
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Feat = { polys: number[][][][]; bbox: [number, number, number, number] };
let feats: Feat[] | null = null;

function load(): Feat[] {
  if (feats) return feats;
  try {
    const raw = readFileSync(join(process.cwd(), "public", "world.geojson"), "utf8");
    const gj = JSON.parse(raw) as GeoJSON.FeatureCollection;
    feats = gj.features.map((f) => {
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      const g = f.geometry;
      const polys = (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) as number[][][][];
      for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return { polys, bbox: [minX, minY, maxX, maxY] };
    });
  } catch {
    feats = [];
  }
  return feats;
}

function ringContains(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isLand(x: number, y: number): boolean {
  for (const f of load()) {
    const [minX, minY, maxX, maxY] = f.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    for (const poly of f.polys) {
      if (!ringContains(poly[0], x, y)) continue;
      let hole = false;
      for (let h = 1; h < poly.length; h++) if (ringContains(poly[h], x, y)) hole = true;
      if (!hole) return true;
    }
  }
  return false;
}

/** True if the straight path between two points passes over open sea. */
export function pathCrossesWater(ax: number, ay: number, bx: number, by: number, samples = 14): boolean {
  if (!load().length) return false; // no data → don't block
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    if (!isLand(ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
  }
  return false;
}
