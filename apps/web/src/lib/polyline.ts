export type LngLat = [number, number];

const EARTH_RADIUS_M = 6371000;

const toRad = (deg: number): number => {
  return (deg * Math.PI) / 180;
};

const haversineMeters = (a: LngLat, b: LngLat): number => {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
};

const bearingDegrees = (a: LngLat, b: LngLat): number => {
  const [lon1, lat1] = a.map(toRad) as LngLat;
  const [lon2, lat2] = b.map(toRad) as LngLat;
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

/**
 * Moves `point` `distanceMeters` along `bearingDeg` (standard spherical destination-point
 * formula) — used to nudge a vehicle marker sideways off its raw track, the same way the
 * static line layer is nudged via MapLibre's line-offset paint property. That paint
 * property only ever shifts pixels on screen, never the underlying coordinates, so a
 * vehicle computed straight from the raw polyline sits exactly where two lines' real,
 * physically shared track (e.g. RER A and E near Vincennes) actually coincide — reading as
 * if it belongs to whichever line the viewer happens to associate with that path, not
 * whichever line it's actually on. This closes that gap for the moving marker itself.
 */
export const offsetPoint = (point: LngLat, bearingDeg: number, distanceMeters: number): LngLat => {
  if (distanceMeters === 0) return point;
  const [lon, lat] = point;
  const angularDist = distanceMeters / EARTH_RADIUS_M;
  const bearingRad = toRad(bearingDeg);
  const latRad = toRad(lat);
  const lonRad = toRad(lon);

  const newLatRad = Math.asin(Math.sin(latRad) * Math.cos(angularDist) + Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearingRad));
  const newLonRad =
    lonRad +
    Math.atan2(Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(latRad), Math.cos(angularDist) - Math.sin(latRad) * Math.sin(newLatRad));

  return [(newLonRad * 180) / Math.PI, (newLatRad * 180) / Math.PI];
};

/**
 * Client-side mirror of apps/server/src/geometry.ts's Polyline (pointAtFraction only —
 * the client never needs nearestFraction, that's a server-side ingestion concern).
 * Duplicated rather than shared across the two packages for one small, stable file.
 */
export class Polyline {
  readonly coords: LngLat[];
  readonly cumulative: number[];
  readonly totalLength: number;

  constructor(coords: LngLat[]) {
    this.coords = coords;
    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) {
      cumulative.push(cumulative[i - 1] + haversineMeters(coords[i - 1], coords[i]));
    }
    this.cumulative = cumulative;
    this.totalLength = cumulative[cumulative.length - 1] ?? 0;
  }

  pointAtFraction(fraction: number): { position: LngLat; bearing: number } {
    const clamped = Math.max(0, Math.min(1, fraction));
    const targetDist = clamped * this.totalLength;

    let i = 1;
    while (i < this.cumulative.length && this.cumulative[i] < targetDist) i++;
    i = Math.min(i, this.coords.length - 1);

    const segStart = this.coords[i - 1];
    const segEnd = this.coords[i];
    const segStartDist = this.cumulative[i - 1];
    const segEndDist = this.cumulative[i];
    const segLen = segEndDist - segStartDist;
    const t = segLen > 0 ? (targetDist - segStartDist) / segLen : 0;

    const position: LngLat = [segStart[0] + (segEnd[0] - segStart[0]) * t, segStart[1] + (segEnd[1] - segStart[1]) * t];
    return { position, bearing: bearingDegrees(segStart, segEnd) };
  }
}
