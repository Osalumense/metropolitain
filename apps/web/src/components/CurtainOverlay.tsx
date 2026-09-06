"use client";

import type { ThemePalette } from "@/lib/theme";

interface CurtainOverlayProps {
  mounted: boolean;
  open: boolean;
  durationMs: number;
  palette: ThemePalette;
  loadError: boolean;
  lang: "en" | "fr";
}

const CurtainOverlay = ({
  mounted,
  open,
  durationMs,
  palette,
  loadError,
  lang,
}: CurtainOverlayProps) => {
  if (!mounted) return null;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: open ? "none" : "auto" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "50%",
          background: palette.ground,
          transform: open ? "translateY(-100%)" : "translateY(0)",
          transition: `transform ${durationMs}ms cubic-bezier(0.76, 0, 0.24, 1)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "50%",
          background: palette.ground,
          transform: open ? "translateY(100%)" : "translateY(0)",
          transition: `transform ${durationMs}ms cubic-bezier(0.76, 0, 0.24, 1)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: open ? 0 : 1,
          transition: "opacity 0.35s ease",
        }}
      >
        <div
          style={{
            color: palette.ink,
            fontFamily: "Georgia, serif",
            letterSpacing: "0.1em",
            fontSize: 20,
            textTransform: "uppercase",
          }}
        >
          Métropolitain
        </div>
        {loadError ? (
          <>
            <div
              style={{
                marginTop: 14,
                color: palette.disruption,
                fontSize: 11,
                letterSpacing: "0.1em",
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              {lang === "en"
                ? "COULD NOT REACH THE NETWORK — CHECK YOUR CONNECTION"
                : "IMPOSSIBLE DE JOINDRE LE RÉSEAU — VÉRIFIEZ VOTRE CONNEXION"}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: "8px 20px",
                background: "transparent",
                border: `1px solid ${palette.bronze}`,
                color: palette.ink,
                fontSize: 11,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {lang === "en" ? "Retry" : "Réessayer"}
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                marginTop: 14,
                width: 28,
                height: 28,
                border: `2px solid ${palette.bronze}`,
                borderTopColor: palette.amberLamp,
                borderRadius: "50%",
                animation: "metropolitain-spin 0.9s linear infinite",
              }}
            />
            <div style={{ marginTop: 14, color: palette.ink, opacity: 0.6, fontSize: 11, letterSpacing: "0.15em" }}>
              {lang === "en" ? "LOADING THE NETWORK…" : "CHARGEMENT DU RÉSEAU…"}
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes metropolitain-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default CurtainOverlay;
