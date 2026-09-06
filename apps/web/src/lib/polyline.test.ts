import test from "node:test";
import assert from "node:assert/strict";
import { offsetPoint, Polyline, type LngLat } from "./polyline";

test("offsetPoint shifts coordinate perpendicular to heading by given distance", () => {
  const start: LngLat = [2.35, 48.85];

  // 0 distance returns identical coordinate
  const zeroOffset = offsetPoint(start, 90, 0);
  assert.strictEqual(zeroOffset[0], start[0]);
  assert.strictEqual(zeroOffset[1], start[1]);

  // Heading 0 deg (north) + 90 deg = 90 deg (east)
  // Shifting 100m east should increase longitude, keeping latitude nearly identical
  const shiftedEast = offsetPoint(start, 90, 100);
  assert.ok(shiftedEast[0] > start[0], "Longitude should increase when offset east");
  assert.ok(Math.abs(shiftedEast[1] - start[1]) < 1e-4, "Latitude should remain close when offset east");
});

test("client Polyline computes fraction points accurately", () => {
  const coords: LngLat[] = [
    [2.3, 48.8],
    [2.4, 48.8],
  ];
  const poly = new Polyline(coords);

  assert.ok(poly.totalLength > 0);

  const start = poly.pointAtFraction(0);
  assert.strictEqual(start.position[0], 2.3);
  assert.strictEqual(start.position[1], 48.8);

  const midpoint = poly.pointAtFraction(0.5);
  assert.ok(Math.abs(midpoint.position[0] - 2.35) < 1e-4);
  assert.ok(Math.abs(midpoint.position[1] - 48.8) < 1e-4);

  const end = poly.pointAtFraction(1);
  assert.strictEqual(end.position[0], 2.4);
  assert.strictEqual(end.position[1], 48.8);
});
