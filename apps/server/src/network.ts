import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Polyline, simplifyPolyline, type LngLat } from "./geometry.js";
import { LINE_REGISTRY } from "./lineRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

export interface Branch {
  branchId: string;
  polyline: Polyline;
}

export interface LineDefinition {
  id: string;
  lineRef: string;
  shortName: string;
  color: string;
  textColor: string;
  /** Every real branch (distinct pair of true end-of-track termini) this line runs, not
   *  one cherry-picked representative — RER/Transilien lines fork; rendering only one
   *  branch either hides real trains on the others or, worse, mis-locates them onto the
   *  wrong track. Métro lines have exactly one. */
  branches: Branch[];
  featureCollection: GeoJSON.FeatureCollection;
}

const LIVE_LINE_IDS = new Set(Object.keys(LINE_REGISTRY));

// Deterministic small pixel offset per line (MapLibre's native line-offset paint
// property), so two lines that share real physical track for a stretch — e.g. RER A and
// E near Vincennes — render as visually distinct parallel lines instead of one painting
// directly over the other. Purely a rendering convention (same idea official transit maps
// use for shared corridors); doesn't touch real geometry or position data.
const OFFSET_STEPS = [0, -2.5, 2.5, -5, 5, -1.25, 1.25, -3.75, 3.75, -6.25, 6.25];
const offsetForIndex = (i: number): number => {
  return OFFSET_STEPS[i % OFFSET_STEPS.length];
};

const loadLine = (id: string, index: number): LineDefinition => {
  const info = LINE_REGISTRY[id];
  const raw = JSON.parse(readFileSync(path.join(DATA_DIR, `${id}.geojson`), "utf-8")) as GeoJSON.FeatureCollection;
  const offset = offsetForIndex(index);

  // Assign (and write back onto the feature) a branchId for every LineString that
  // doesn't already have one — single-branch lines (Métro, and any file that predates the
  // branch-extraction pass) never had this property, and if it's only synthesized in
  // memory here without being written into the served GeoJSON, the client's polyline
  // lookup silently fails for every vehicle on that line. Written once, read everywhere.
  const branches: Branch[] = [];
  let branchIndex = 0;
  for (const feature of raw.features) {
    if (feature.geometry.type !== "LineString") continue;
    const existing = (feature.properties as { branchId?: string })?.branchId;
    const branchId = existing ?? `${id}::${branchIndex++}`;
    feature.properties = { ...feature.properties, branchId };

    // Raw GTFS shapes carry a vertex every few meters — simplified once here, so both the
    // served GeoJSON (payload size) and every nearestFractionAndDistance scan during
    // real-time ingestion (see idfmIngestion.ts) work off the same, much smaller polyline.
    const simplified = simplifyPolyline(feature.geometry.coordinates as LngLat[], 5);
    feature.geometry.coordinates = simplified;
    branches.push({ branchId, polyline: new Polyline(simplified) });
  }

  // Stamp the registry's id/lineId/color/short_name/isLive/offset/mode onto every feature (every
  // branch line + every station) so the client never needs its own copy of the registry.
  for (const feature of raw.features) {
    feature.properties = {
      ...feature.properties,
      id: info.id,
      lineId: info.id,
      color: info.color,
      text_color: info.textColor,
      short_name: info.shortName,
      isLive: LIVE_LINE_IDS.has(id),
      offset,
      mode: info.mode,
    };
  }

  return {
    id: info.id,
    lineRef: info.lineRef,
    shortName: info.shortName,
    color: info.color,
    textColor: info.textColor,
    branches,
    featureCollection: raw,
  };
};

/**
 * Real geometry and stop sequences from IDFM's own GTFS static bundle
 * (eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip, Mobility License). Every real branch
 * (true end-of-track terminus pair, not short-turn/peak-only partial services) is kept as
 * its own LineString — see the branch-extraction notes in PRODUCT.md for how those were
 * distinguished from partial services. Every line in LINE_REGISTRY with a matching data
 * file loads automatically.
 */
export const ALL_LINES: LineDefinition[] = Object.keys(LINE_REGISTRY)
  .filter((id) => existsSync(path.join(DATA_DIR, `${id}.geojson`)))
  .map((id, index) => loadLine(id, index));

/** All lines are live-tracked — see LIVE_LINE_IDS above. */
export const LIVE_LINES: LineDefinition[] = ALL_LINES.filter((l) => LIVE_LINE_IDS.has(l.id));

/**
 * Built once, here, rather than by each caller on every poll cycle — LIVE_LINES never
 * changes after startup, so re-deriving a lookup index from it per call (as idfmIngestion.ts
 * used to) is pure repeated work for a static result.
 */
export const LINE_BY_ID: Map<string, LineDefinition> = new Map(LIVE_LINES.map((l) => [l.id, l]));
export const LINE_BY_REF: Map<string, LineDefinition> = new Map(LIVE_LINES.map((l) => [l.lineRef, l]));

export const networkGeoJSON = (): GeoJSON.FeatureCollection => {
  return {
    type: "FeatureCollection",
    features: ALL_LINES.flatMap((l) => l.featureCollection.features),
  };
};

/**
 * Resolves a SIRI StopPointRef's bare quay code (e.g. "24859" from
 * "STIF:StopPoint:Q:24859:") to real coordinates, via IDFM's own GTFS
 * object_codes_extension.txt cross-reference (netex_zder_quay -> GTFS stop_id -> stops.txt).
 */
const quayLocationRaw = JSON.parse(
  readFileSync(path.join(DATA_DIR, "quay-location.json"), "utf-8")
) as Record<string, { lat: number; lon: number; name: string }>;

export const quayLocation = (quayCode: string): { lat: number; lon: number; name: string } | undefined => {
  return quayLocationRaw[quayCode];
};
