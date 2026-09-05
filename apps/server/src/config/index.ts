import "dotenv/config";

/**
 * Single place every environment variable this server reads gets loaded and validated —
 * nothing else in the codebase should touch process.env directly. That way a missing or
 * malformed value fails once, here, at startup with a clear name, instead of surfacing as
 * an obscure runtime error wherever it happened to first get used.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

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
};
