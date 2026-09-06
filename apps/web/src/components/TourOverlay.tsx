"use client";

import type { ThemePalette } from "@/lib/theme";
import type { TourStepDef } from "@/types";

interface TourOverlayProps {
  tourStep: number | null;
  tourRect: { top: number; left: number; width: number; height: number } | null;
  steps: TourStepDef[];
  lang: "en" | "fr";
  palette: ThemePalette;
  panelBgSolid: string;
  onAdvance: () => void;
  onEnd: () => void;
}

const TourOverlay = ({
  tourStep,
  tourRect,
  steps,
  lang,
  palette,
  panelBgSolid,
  onAdvance,
  onEnd,
}: TourOverlayProps) => {
  if (tourStep === null) return null;

  const step = steps[tourStep];
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const CARD_H_ESTIMATE = 190;
  const placeBelow = !tourRect || tourRect.top + tourRect.height / 2 < vh / 2;
  const rawTop = tourRect ? (placeBelow ? tourRect.top + tourRect.height + 16 : tourRect.top - 16 - CARD_H_ESTIMATE) : null;
  const clampedTop = rawTop === null ? null : Math.min(Math.max(rawTop, 16), Math.max(16, vh - CARD_H_ESTIMATE - 16));

  const card = (
    <div
      style={{
        width: "min(320px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 32px)",
        overflowY: "auto",
        background: panelBgSolid,
        border: `1px solid ${palette.bronze}`,
        borderRadius: 4,
        padding: 16,
        boxSizing: "border-box",
        color: palette.ink,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: "0.1em", marginBottom: 6 }}>
        {tourStep + 1} / {steps.length}
      </div>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 15, marginBottom: 6 }}>
        {lang === "en" ? step.titleEn : step.titleFr}
      </div>
      <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5, marginBottom: 14 }}>
        {lang === "en" ? step.bodyEn : step.bodyFr}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={onEnd}
          style={{ background: "none", border: "none", color: palette.ink, opacity: 0.6, fontSize: 11, cursor: "pointer" }}
        >
          {lang === "en" ? "Skip" : "Passer"}
        </button>
        <button
          onClick={onAdvance}
          style={{
            background: palette.amberLamp,
            color: palette.ground,
            border: "none",
            borderRadius: 2,
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {tourStep >= steps.length - 1 ? (lang === "en" ? "Got it" : "Compris") : lang === "en" ? "Next" : "Suivant"}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      {!tourRect && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)" }} />}
      {tourRect && (
        <div
          style={{
            position: "fixed",
            top: tourRect.top - 6,
            left: tourRect.left - 6,
            width: tourRect.width + 12,
            height: tourRect.height + 12,
            borderRadius: 6,
            border: `2px solid ${palette.amberLamp}`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
            pointerEvents: "none",
          }}
        />
      )}
      {tourRect ? (
        <div style={{ position: "fixed", top: clampedTop as number, left: "50%", transform: "translateX(-50%)" }}>
          {card}
        </div>
      ) : (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
        >
          {card}
        </div>
      )}
    </div>
  );
};

export default TourOverlay;
