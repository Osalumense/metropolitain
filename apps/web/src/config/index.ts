/**
 * Single place every environment variable this app reads gets resolved — nothing else in
 * the codebase should touch process.env directly. NEXT_PUBLIC_* values are inlined into the
 * client bundle at build time (see apps/web/Dockerfile), so this module doesn't do anything
 * dynamic at runtime — it just gives the rest of the app one name to import instead of
 * repeating the same env var + fallback pair wherever it's needed.
 */
export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001/ws",

  // Third-party base-map tiles — not deployment-specific, but centralized here like
  // every other fixed endpoint this app talks to (see MetroMap.tsx).
  mapStyleUrl: "https://tiles.openfreemap.org/styles/liberty",

  // Cloudflare Web Analytics (see layout.tsx) — cookieless, no consent banner needed.
  // The token isn't a secret: Cloudflare's beacon script is designed to sit in public
  // page source, the same as a Google Analytics measurement ID.
  cloudflareBeaconUrl: "https://static.cloudflareinsights.com/beacon.min.js",
  cloudflareBeaconToken: process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ?? "7dae5c543bab44e483581398efb24c70",

  // How long to wait for our own backend's /api/network before retrying once, then
  // surfacing a real error — see fetchNetworkWithRetry in MetroMap.tsx.
  networkFetchTimeoutMs: 8000,

  // WebSocket reconnect backoff: starts fast, doubles up to the ceiling on every
  // failed attempt, resets once a connection actually succeeds.
  wsReconnectInitialDelayMs: 1000,
  wsReconnectMaxDelayMs: 30_000,
};
