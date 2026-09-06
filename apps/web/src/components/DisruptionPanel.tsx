"use client";

import type { ThemePalette } from "@/lib/theme";
import type { Disruption, DisruptionSeverity, LineMeta } from "@/types";

interface DisruptionPanelProps {
  badgeRef?: React.Ref<HTMLButtonElement>;
  open: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  activeLineIds: Set<string>;
  worstActiveSeverity: DisruptionSeverity | null;
  activeByLine: [string, Disruption[]][];
  upcomingByLine: [string, Disruption[]][];
  upcomingDisruptionsCount: number;
  upcomingOpen: boolean;
  onToggleUpcoming: () => void;
  expandedDisruptionId: string | null;
  onToggleExpanded: (id: string) => void;
  lastUpdate: number | null;
  lang: "en" | "fr";
  palette: ThemePalette;
  panelBg: string;
  panelBgSolid: string;
  lineMeta: Map<string, LineMeta>;
}

const DisruptionPanel = ({
  badgeRef,
  open,
  onToggleOpen,
  onClose,
  activeLineIds,
  worstActiveSeverity,
  activeByLine,
  upcomingByLine,
  upcomingDisruptionsCount,
  upcomingOpen,
  onToggleUpcoming,
  expandedDisruptionId,
  onToggleExpanded,
  lastUpdate,
  lang,
  palette,
  panelBg,
  panelBgSolid,
  lineMeta,
}: DisruptionPanelProps) => {
  const severityColor = (sev: DisruptionSeverity): string => {
    return sev === "blocking" ? palette.disruption : sev === "reduced" ? palette.amberLamp : palette.ink;
  };

  const formatPeriod = (d: Disruption): string | null => {
    const now = Date.now();
    const period = d.periods.find((p) => now <= p.end) ?? d.periods[0];
    if (!period) return null;
    const fmt = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const isToday = new Date(period.begin).toDateString() === new Date(now).toDateString();
    if (isToday && period.begin <= now) {
      const endFmt = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });
      return `${lang === "en" ? "Until" : "Jusqu'à"} ${endFmt.format(period.end)}`;
    }
    return fmt.format(period.begin);
  };

  return (
    <>
      {/* Compact, always-visible disruption indicator */}
      <button
        ref={badgeRef}
        onClick={onToggleOpen}
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: panelBg,
          color: palette.ink,
          border: `1px solid ${activeLineIds.size > 0 ? severityColor(worstActiveSeverity ?? "info") : palette.bronze}`,
          borderRadius: 3,
          padding: "6px 10px",
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
          cursor: "pointer",
        }}
      >
        {activeLineIds.size > 0 && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: severityColor(worstActiveSeverity ?? "info"),
              display: "inline-block",
            }}
          />
        )}
        {activeLineIds.size === 0
          ? lang === "en"
            ? "All clear"
            : "Trafic normal"
          : lang === "en"
            ? `${activeLineIds.size} line${activeLineIds.size > 1 ? "s" : ""} disrupted`
            : `${activeLineIds.size} ligne${activeLineIds.size > 1 ? "s" : ""} perturbée${activeLineIds.size > 1 ? "s" : ""}`}
      </button>

      {/* Slide-in panel: map stays visible and interactive behind it */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 5,
          width: 340,
          maxWidth: "85vw",
          background: panelBgSolid,
          borderLeft: `1px solid ${palette.bronze}`,
          color: palette.ink,
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          padding: 16,
          overflowY: "auto",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ letterSpacing: "0.1em", fontSize: 11, opacity: 0.7 }}>
            {lang === "en" ? "DISRUPTIONS" : "PERTURBATIONS"}
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
              marginRight: -6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label={lang === "en" ? "Close" : "Fermer"}
          >
            ×
          </button>
        </div>

        {activeByLine.length === 0 ? (
          <div style={{ opacity: 0.5 }}>{lang === "en" ? "All clear" : "Trafic normal"}</div>
        ) : (
          activeByLine.map(([lineId, items]) => {
            const meta = lineMeta.get(lineId);
            return (
              <div key={lineId} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: meta?.color ?? palette.bronze,
                      color: meta?.textColor ?? "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {meta?.shortName ?? lineId}
                  </span>
                </div>
                {items.map((d) => {
                  const expanded = expandedDisruptionId === d.id;
                  const period = formatPeriod(d);
                  return (
                    <div
                      key={d.id}
                      onClick={() => onToggleExpanded(d.id)}
                      style={{
                        borderLeft: `2px solid ${severityColor(d.severity)}`,
                        padding: "4px 8px",
                        marginBottom: 4,
                        marginLeft: 26,
                        cursor: "pointer",
                      }}
                    >
                      <div>{lang === "en" ? d.shortTextEn : d.shortTextFr}</div>
                      {period && <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>{period}</div>}
                      {expanded && (
                        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6, lineHeight: 1.4 }}>
                          {lang === "en" ? d.textEn : d.textFr}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}

        {upcomingByLine.length > 0 && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${palette.bronze}`, paddingTop: 12 }}>
            <div
              onClick={onToggleUpcoming}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer",
                opacity: 0.7,
                fontSize: 11,
                letterSpacing: "0.05em",
              }}
            >
              <span>
                {lang === "en" ? `UPCOMING (${upcomingDisruptionsCount})` : `À VENIR (${upcomingDisruptionsCount})`}
              </span>
              <span>{upcomingOpen ? "▾" : "▸"}</span>
            </div>
            {upcomingOpen && (
              <div style={{ marginTop: 8 }}>
                {upcomingByLine.map(([lineId, items]) => {
                  const meta = lineMeta.get(lineId);
                  return (
                    <div key={lineId} style={{ marginBottom: 10, opacity: 0.7 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: meta?.color ?? palette.bronze,
                            color: meta?.textColor ?? "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {meta?.shortName ?? lineId}
                        </span>
                      </div>
                      {items.map((d) => {
                        const expanded = expandedDisruptionId === d.id;
                        const period = formatPeriod(d);
                        return (
                          <div
                            key={d.id}
                            onClick={() => onToggleExpanded(d.id)}
                            style={{
                              padding: "3px 8px",
                              marginBottom: 3,
                              marginLeft: 24,
                              cursor: "pointer",
                              fontSize: 11,
                            }}
                          >
                            <div>{lang === "en" ? d.shortTextEn : d.shortTextFr}</div>
                            {period && <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{period}</div>}
                            {expanded && (
                              <div style={{ fontSize: 11, opacity: 0.9, marginTop: 6, lineHeight: 1.4 }}>
                                {lang === "en" ? d.textEn : d.textFr}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {lastUpdate && (
          <div style={{ opacity: 0.4, fontSize: 10, marginTop: 12 }}>
            {lang === "en" ? "Updated" : "Mis à jour"} {new Date(lastUpdate).toLocaleTimeString()}
          </div>
        )}
      </div>
    </>
  );
};

export default DisruptionPanel;
