import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

/**
 * Single place every environment variable this server reads gets loaded and validated —
 * nothing else in the codebase should touch process.env directly. That way a missing or
 * malformed value fails once, here, at startup with a clear name, instead of surfacing as
 * an obscure runtime error wherever it happened to first get used.
 */

const required = (name: string): string => {
  const value = process.env[name] ?? (process.env.NODE_ENV === "test" ? `test-${name.toLowerCase()}` : undefined);
  if (!value) throw new Error(`${name} not set`);
  return value;
};

// Fixed IDFM/DeepL endpoints — not deployment-specific (never meaningfully overridden
// per-environment), but still centralized here rather than hardcoded inline wherever a
// fetch() happens to need one.
const PRIM_BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // Comma-separated so both the apex and www can be allowed — see index.ts for why.
  frontendOrigins: (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim()),
  // Required: this server only ever runs on real IDFM data, no mock fallback.
  primApiKey: required("PRIM_API_KEY"),
  // Optional: translate.ts falls back to untranslated French when this isn't set.
  deeplApiKey: process.env.DEEPL_API_KEY,
  // Positions ~90s (the feed itself only refreshes once/minute, so faster gains nothing),
  // disruptions ~2min (one bulk call/cycle — see idfmIngestion.ts).
  positionIntervalMs: Number(process.env.POSITION_INTERVAL_MS ?? 90_000),
  disruptionIntervalMs: Number(process.env.DISRUPTION_INTERVAL_MS ?? 120_000),

  primBaseUrl: PRIM_BASE_URL,
  disruptionsBulkUrl: `${PRIM_BASE_URL}/disruptions_bulk/disruptions/v2`,
  deeplUrl: "https://api-free.deepl.com/v2/translate",
  // Free, keyless fallback for when DeepL is rate-limited or its monthly quota is
  // exhausted — lower translation quality, but no account/billing to set up, and it's
  // only ever reached when DeepL has already failed.
  myMemoryUrl: "https://api.mymemory.translated.net/get",
  // Mounted as a named Docker volume (see docker-compose.yml) so the translation cache
  // survives a redeploy — without this, every "docker compose build && up -d" recreates
  // the container from scratch, wiping an in-memory-only cache and forcing every disruption
  // to be re-translated at once, which is what actually burned a full month's DeepL quota
  // in one day of shipping fixes.
  translateCachePath:
    process.env.TRANSLATE_CACHE_PATH ??
    (existsSync("/app") ? "/app/cache/translate-cache.json" : path.join(__dirname, "..", "..", "cache", "translate-cache.json")),
  // Floor on the gap between real (non-cached) DeepL calls, and the retry-wait bounds
  // when DeepL itself asks us to back off — see translate.ts for why a cold-cache burst
  // needs pacing at all. Overridable, but not expected to differ per environment.
  translateMinCallIntervalMs: Number(process.env.TRANSLATE_MIN_CALL_INTERVAL_MS ?? 120),
  translateRetryDefaultMs: Number(process.env.TRANSLATE_RETRY_DEFAULT_MS ?? 1500),
  translateRetryMaxMs: Number(process.env.TRANSLATE_RETRY_MAX_MS ?? 5000),

  // Hard safety ceilings on real IDFM calls per day, independent of the polling-interval
  // math above — a defensive backstop against a reconnect storm or a stuck retry loop
  // silently blowing through the quota while nobody's watching. Positions and disruptions
  // are tracked separately since they're different quota buckets. Disruptions run one
  // call/cycle (the bulk endpoint, not one call per line — see idfmIngestion.ts), so 700
  // is real headroom under IDFM's own 1,000/day quota for that endpoint, not just a number
  // that happens not to trip: an earlier "1400, 7 lines x this many cycles/day" cap — sized
  // for a 7-line, one-call-per-line design — was exhausting itself in the first ~62 minutes
  // of every day once 44 lines were tracked, silently skipping disruption fetching for the
  // rest of the day, every day. Confirmed directly against IDFM's real feed.
  maxPositionCallsPerDay: Number(process.env.MAX_POSITION_CALLS_PER_DAY ?? 1400),
  maxDisruptionCallsPerDay: Number(process.env.MAX_DISRUPTION_CALLS_PER_DAY ?? 700),
};
