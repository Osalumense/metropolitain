export type LngLat = [number, number];

const EARTH_RADIUS_M = 6371000;

const toRad = (deg: number): number => {
  return (deg * Math.PI) / 180;
};

export const haversineMeters = (a: LngLat, b: LngLat): number => {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
};

export const bearingDegrees = (a: LngLat, b: LngLat): number => {
  const [lon1, lat1] = a.map(toRad) as LngLat;
  const [lon2, lat2] = b.map(toRad) as LngLat;
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
};

/** A polyline with precomputed cumulative distance at each vertex, for fast position-at-fraction lookups. */
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

  /** Returns position + bearing at `fraction` (0..1) along the line. */
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

    const position: LngLat = [
      segStart[0] + (segEnd[0] - segStart[0]) * t,
      segStart[1] + (segEnd[1] - segStart[1]) * t,
    ];

    return { position, bearing: bearingDegrees(segStart, segEnd) };
  }

  /**
   * Fraction (0..1) along the line of the vertex nearest `point`, plus the distance to it
   * in meters — the distance lets a caller with several candidate branches score which one
   * a real stop actually sits on, rather than blindly snapping to whichever happens to be
   * passed in.
   */
  nearestFractionAndDistance(point: LngLat): { fraction: number; distanceMeters: number } {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.coords.length; i++) {
      const d = haversineMeters(point, this.coords[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return {
      fraction: this.totalLength > 0 ? this.cumulative[bestIdx] / this.totalLength : 0,
      distanceMeters: bestDist,
    };
  }

  /** Fraction only — see nearestFractionAndDistance when branch disambiguation matters. */
  nearestFraction(point: LngLat): number {
    return this.nearestFractionAndDistance(point).fraction;
  }
}

/**
 * Ramer-Douglas-Peucker simplification, in meters, on raw GTFS shape coordinates.
 * These shapes carry a vertex every few meters (way past what any zoom level a viewer
 * actually uses can show), and every extra vertex is extra brute-force distance-scanning
 * work in nearestFractionAndDistance — called per real-time call, per candidate branch,
 * every ingestion cycle. A 5m tolerance is imperceptible on the rendered map but cuts
 * vertex count (and served payload size) by roughly 3x.
 */
export const simplifyPolyline = (coords: LngLat[], toleranceMeters: number): LngLat[] => {
  if (coords.length <= 2) return coords;

  // Local equirectangular projection (meters) — accurate enough at Paris's scale, and only
  // used to pick which vertices to drop, not for any real distance/position math elsewhere.
  const meanLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(toRad(meanLat));
  const xy: [number, number][] = coords.map(([lon, lat]) => [lon * mPerDegLon, lat * mPerDegLat]);

  const perpendicularDistance = (p: [number, number], a: [number, number], b: [number, number]): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    return Math.hypot(p[0] - px, p[1] - py);
  };

  const rdp = (lo: number, hi: number): LngLat[] => {
    let maxDist = -1;
    let splitIdx = lo;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpendicularDistance(xy[i], xy[lo], xy[hi]);
      if (d > maxDist) {
        maxDist = d;
        splitIdx = i;
      }
    }
    if (maxDist > toleranceMeters) {
      const left = rdp(lo, splitIdx);
      const right = rdp(splitIdx, hi);
      return left.slice(0, -1).concat(right);
    }
    return [coords[lo], coords[hi]];
  };

  return rdp(0, coords.length - 1);
};
