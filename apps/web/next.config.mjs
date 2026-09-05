/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained production bundle (only the traced dependencies, not the full
  // node_modules) — the standard, much smaller Docker deployment shape for Next.js.
  output: "standalone",
  // Don't hand attackers free framework fingerprinting via X-Powered-By.
  poweredByHeader: false,
};

export default nextConfig;
