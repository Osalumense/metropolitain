"use client";

import type { ThemePalette } from "@/lib/theme";
import type { LineMeta } from "@/types";

interface LineGroup {
  mode: string;
  lines: [string, LineMeta][];
}

interface LinePanelProps {
  badgeRef?: React.Ref<HTMLButtonElement>;
  open: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  selectedLines: Set<string>;
  onToggleLine: (lineId: string) => void;
  onClearSelection: () => void;
  linesByMode: LineGroup[];
  modeLabels: Record<string, { fr: string; en: string }>;
  lang: "en" | "fr";
  palette: ThemePalette;
  panelBg: string;
  panelBgSolid: string;
}

const LinePanel = ({
  badgeRef,
  open,
  onToggleOpen,
  onClose,
  selectedLines,
  onToggleLine,
  onClearSelection,
  linesByMode,
  modeLabels,
  lang,
  palette,
  panelBg,
  panelBgSolid,
}: LinePanelProps) => {
  return (
    <>
      {/* Line isolation badge: mirrors the disruption badge on opposite corner */}
      <button
        ref={badgeRef}
        onClick={onToggleOpen}
        style={{
          position: "absolute",
          bottom: 44,
          right: 16,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: panelBg,
          color: palette.ink,
          border: `1px solid ${selectedLines.size > 0 ? palette.amberLamp : palette.bronze}`,
          borderRadius: 3,
          padding: "6px 10px",
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
          cursor: "pointer",
        }}
      >
        {selectedLines.size === 0
          ? lang === "en"
            ? "Lines"
            : "Lignes"
          : lang === "en"
            ? `${selectedLines.size} line${selectedLines.size > 1 ? "s" : ""} shown`
            : `${selectedLines.size} ligne${selectedLines.size > 1 ? "s" : ""} affichée${selectedLines.size > 1 ? "s" : ""}`}
      </button>

      {/* Slide-in panel, from the left */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 5,
          width: 320,
          maxWidth: "85vw",
          background: panelBgSolid,
          borderRight: `1px solid ${palette.bronze}`,
          color: palette.ink,
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          padding: 16,
          overflowY: "auto",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ letterSpacing: "0.1em", fontSize: 11, opacity: 0.7 }}>
            {lang === "en" ? "LINES" : "LIGNES"}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: palette.ink,
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
              width: 32,
              height: 32,
              marginLeft: -6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label={lang === "en" ? "Close" : "Fermer"}
          >
            ×
          </button>
        </div>

        {selectedLines.size > 0 && (
          <button
            onClick={onClearSelection}
            style={{
              background: "none",
              border: `1px solid ${palette.bronze}`,
              color: palette.ink,
              borderRadius: 3,
              padding: "4px 8px",
              fontSize: 11,
              cursor: "pointer",
              marginBottom: 14,
            }}
          >
            {lang === "en" ? "Show all lines" : "Tout afficher"}
          </button>
        )}

        {linesByMode.map(({ mode, lines }) => (
          <div key={mode} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: "0.1em", marginBottom: 6 }}>
              {lang === "en" ? modeLabels[mode]?.en : modeLabels[mode]?.fr}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {lines.map(([lineId, meta]) => {
                const isSelected = selectedLines.has(lineId);
                const dimmed = selectedLines.size > 0 && !isSelected;
                return (
                  <button
                    key={lineId}
                    onClick={() => onToggleLine(lineId)}
                    title={meta.shortName}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: meta.color,
                      color: meta.textColor,
                      border: isSelected ? `2px solid ${palette.amberLamp}` : "2px solid transparent",
                      opacity: dimmed ? 0.35 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                      flexShrink: 0,
                      padding: 0,
                    }}
                  >
                    {meta.shortName}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default LinePanel;
