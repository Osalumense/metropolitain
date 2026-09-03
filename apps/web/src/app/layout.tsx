import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Métropolitain — live",
  description: "Paris's Métro and RER, moving in real time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#1c1a16", overflow: "hidden" }}>{children}</body>
    </html>
  );
}
