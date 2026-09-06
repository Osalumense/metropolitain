import test from "node:test";
import assert from "node:assert/strict";
import {
  extractQuayCode,
  normalizeSeverity,
  parseParisDateTime,
  stripHtml,
} from "./idfmIngestion.js";

test("extractQuayCode parses trailing numeric quay codes and rejects non-numeric references", () => {
  assert.strictEqual(extractQuayCode("STIF:StopPoint:Q:24859:"), "24859");
  assert.strictEqual(extractQuayCode("STIF:StopPoint:Q:102030"), "102030");
  assert.strictEqual(extractQuayCode("STIF:StopPoint:Q:INVALID:"), null);
  assert.strictEqual(extractQuayCode("not-a-valid-quay"), null);
  assert.strictEqual(extractQuayCode(""), null);
});

test("normalizeSeverity maps IDFM severity codes to normalized client values", () => {
  assert.strictEqual(normalizeSeverity("BLOQUANTE"), "blocking");
  assert.strictEqual(normalizeSeverity("PERTURBEE"), "reduced");
  assert.strictEqual(normalizeSeverity("INFORMATION"), "info");
  assert.strictEqual(normalizeSeverity(undefined), "info");
  assert.strictEqual(normalizeSeverity("UNKNOWN_CODE"), "info");
});

test("stripHtml removes tags and decodes common HTML entities", () => {
  const html = "<p>Incident voyageur à <strong>Châtelet</strong>.</p><br>Reprise du trafic estimée.";
  const cleaned = stripHtml(html);
  assert.strictEqual(cleaned, "Incident voyageur à Châtelet . Reprise du trafic estimée.");

  const entities = "Ligne 1 &amp; Ligne 2 &quot;retard&quot; &lt;attention&gt;";
  assert.strictEqual(stripHtml(entities), 'Ligne 1 & Ligne 2 "retard" <attention>');
});

test("parseParisDateTime correctly accounts for Paris CET/CEST daylight saving time", () => {
  // Summer date (CEST, UTC+2): 2026-07-15 14:30:00 Paris = 12:30:00 UTC
  const summerStr = "20260715T143000";
  const summerMs = parseParisDateTime(summerStr);
  assert.ok(summerMs !== null);
  const expectedSummerUtc = Date.UTC(2026, 6, 15, 12, 30, 0);
  assert.strictEqual(summerMs, expectedSummerUtc);

  // Winter date (CET, UTC+1): 2026-01-15 14:30:00 Paris = 13:30:00 UTC
  const winterStr = "20260115T143000";
  const winterMs = parseParisDateTime(winterStr);
  assert.ok(winterMs !== null);
  const expectedWinterUtc = Date.UTC(2026, 0, 15, 13, 30, 0);
  assert.strictEqual(winterMs, expectedWinterUtc);

  // Malformed timestamp returns null
  assert.strictEqual(parseParisDateTime("invalid-date"), null);
  assert.strictEqual(parseParisDateTime("2026-07-15T14:30:00"), null);
});
