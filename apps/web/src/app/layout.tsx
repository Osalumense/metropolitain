import type { Metadata } from "next";
import Script from "next/script";
import { config } from "@/config";

export const metadata: Metadata = {
  title: "Métropolitain — live",
  description: "Paris's Métro and RER, moving in real time.",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    // overflow: hidden on <body> alone doesn't stop <html> itself from being the page's
    // scrolling element in every browser — a focused element positioned even slightly
    // outside the current viewport (a newly clicked button mid-transition, for instance)
    // can trigger the browser's own "scroll focused element into view," and since <html>
    // allowed it, the whole page would shift, dragging every position:absolute/fixed piece
    // of UI chrome sideways with it. This app never legitimately scrolls in any direction.
    <html lang="en" style={{ overflow: "hidden" }}>
      <body style={{ margin: 0, background: "#1c1a16", overflow: "hidden" }}>
        {children}
        {/* Cloudflare Web Analytics — cookieless, no consent banner needed. */}
        <Script
          type="module"
          src={config.cloudflareBeaconUrl}
          data-cf-beacon={`{"token": "${config.cloudflareBeaconToken}"}`}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
};

export default RootLayout;
