"use client";

import { forwardRef } from "react";
import type { ThemePalette } from "@/lib/theme";
import type { ThemeMode } from "@/types";

interface ThemeControlProps {
  themeMode: ThemeMode;
  panelBg: string;
  palette: ThemePalette;
  lang: "en" | "fr";
  onThemeModeChange: (mode: ThemeMode) => void;
}

const ThemeControl = forwardRef<HTMLDivElement, ThemeControlProps>(
  ({ themeMode, panelBg, palette, lang, onThemeModeChange }, ref) => {
    const modes: [ThemeMode, string][] = [
      ["dark", lang === "en" ? "DARK" : "SOMBRE"],
      ["light", lang === "en" ? "LIGHT" : "CLAIR"],
      ["auto", "AUTO"],
    ];

    return (
      <div
        ref={ref}
        className="mp-theme"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: panelBg,
          border: `1px solid ${palette.bronze}`,
          borderRadius: 3,
          padding: "4px 6px",
        }}
      >
        {modes.map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => onThemeModeChange(mode)}
            style={{
              background: themeMode === mode ? palette.amberLamp : "transparent",
              color: themeMode === mode ? palette.ground : palette.ink,
              border: "none",
              borderRadius: 2,
              padding: "3px 7px",
              fontSize: 10,
              letterSpacing: "0.05em",
              fontWeight: themeMode === mode ? 700 : 400,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
);

ThemeControl.displayName = "ThemeControl";

export default ThemeControl;
