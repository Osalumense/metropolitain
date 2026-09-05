import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Métropolitain — live",
  description: "Paris's Métro and RER, moving in real time.",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#1c1a16", overflow: "hidden" }}>
        {children}
        {/* Cloudflare Web Analytics — cookieless, no consent banner needed. */}
        <Script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "7dae5c543bab44e483581398efb24c70"}'
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
};

export default RootLayout;
