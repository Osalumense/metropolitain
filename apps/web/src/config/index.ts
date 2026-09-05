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
};
