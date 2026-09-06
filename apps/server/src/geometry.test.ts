import test from "node:test";
import assert from "node:assert/strict";
import { haversineMeters, bearingDegrees, Polyline, simplifyPolyline, type LngLat } from "./geometry.js";

test("haversineMeters computes distance between known coordinates accurately", () => {
  // Paris Châtelet (approx [2.3470, 48.8584]) to Gare de Lyon (approx [2.3735, 48.8448]) is ~2.4km
  const chatelet: LngLat = [2.347, 48.8584];
  const gareDeLyon: LngLat = [2.3735, 48.8448];
  const dist = haversineMeters(chatelet, gareDeLyon);
  assert.ok(dist > 2300 && dist < 2600, `Expected distance ~2450m, got ${dist}`);

  // Distance to self is 0
  assert.strictEqual(haversineMeters(chatelet, chatelet), 0);
});

test("bearingDegrees calculates cardinal and intercardinal bearings", () => {
  const origin: LngLat = [2.35, 48.85];
  const north: LngLat = [2.35, 48.95];
  const east: LngLat = [2.45, 48.85];
  const south: LngLat = [2.35, 48.75];
  const west: LngLat = [2.25, 48.85];

  const bNorth = bearingDegrees(origin, north);
  const bEast = bearingDegrees(origin, east);
  const bSouth = bearingDegrees(origin, south);
  const bWest = bearingDegrees(origin, west);

  assert.ok(Math.abs(bNorth - 0) < 1 || Math.abs(bNorth - 360) < 1, `North bearing should be ~0, got ${bNorth}`);
  assert.ok(Math.abs(bEast - 90) < 1, `East bearing should be ~90, got ${bEast}`);
  assert.ok(Math.abs(bSouth - 180) < 1, `South bearing should be ~180, got ${bSouth}`);
  assert.ok(Math.abs(bWest - 270) < 1, `West bearing should be ~270, got ${bWest}`);
});

test("Polyline calculates cumulative distances and points at fractions", () => {
  const coords: LngLat[] = [
    [2.3, 48.8],
    [2.4, 48.8],
    [2.5, 48.8],
  ];
  const poly = new Polyline(coords);

  assert.ok(poly.totalLength > 0);
  assert.strictEqual(poly.coords.length, 3);
  assert.strictEqual(poly.cumulative.length, 3);

  // Fraction 0: start point
  const atZero = poly.pointAtFraction(0);
  assert.strictEqual(atZero.position[0], 2.3);
  assert.strictEqual(atZero.position[1], 48.8);

  // Fraction 0.5: middle point
  const atHalf = poly.pointAtFraction(0.5);
  assert.ok(Math.abs(atHalf.position[0] - 2.4) < 1e-4);
  assert.ok(Math.abs(atHalf.position[1] - 48.8) < 1e-4);

  // Fraction 1: end point
  const atOne = poly.pointAtFraction(1);
  assert.ok(Math.abs(atOne.position[0] - 2.5) < 1e-4);
  assert.ok(Math.abs(atOne.position[1] - 48.8) < 1e-4);
});

test("Polyline nearestFractionAndDistance identifies closest vertex on the line", () => {
  const coords: LngLat[] = [
    [2.3, 48.8],
    [2.4, 48.8],
    [2.5, 48.8],
  ];
  const poly = new Polyline(coords);

  // Point right next to the middle vertex
  const nearby: LngLat = [2.4001, 48.8001];
  const res = poly.nearestFractionAndDistance(nearby);

  assert.ok(Math.abs(res.fraction - 0.5) < 0.05);
  assert.ok(res.distanceMeters < 50, `Distance should be small, got ${res.distanceMeters}`);
});

test("simplifyPolyline reduces vertex count while preserving endpoints", () => {
  // A line of 11 collinear points
  const collinear: LngLat[] = [];
  for (let i = 0; i <= 10; i++) {
    collinear.push([2.0 + i * 0.01, 48.0]);
  }
  assert.strictEqual(collinear.length, 11);

  const simplified = simplifyPolyline(collinear, 5);
  // Collinear points within tolerance should be simplified to just start and end
  assert.strictEqual(simplified.length, 2);
  assert.deepStrictEqual(simplified[0], collinear[0]);
  assert.deepStrictEqual(simplified[1], collinear[collinear.length - 1]);
});
