"use client";

import { forwardRef } from "react";
import type { ThemePalette } from "@/lib/theme";

interface SpeedControlProps {
  speed: number;
  speedOptions: readonly number[];
  panelBg: string;
  palette: ThemePalette;
  lang: "en" | "fr";
  onSpeedChange: (speed: number) => void;
}

const SpeedControl = forwardRef<HTMLDivElement, SpeedControlProps>(
  ({ speed, speedOptions, panelBg, palette, lang, onSpeedChange }, ref) => {
    return (
      <div
        ref={ref}
        className="mp-speed"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: panelBg,
          border: `1px solid ${palette.bronze}`,
          borderRadius: 3,
          padding: "4px 8px",
        }}
      >
        <span style={{ color: palette.ink, fontSize: 10, letterSpacing: "0.1em", opacity: 0.7, marginRight: 2 }}>
          {lang === "en" ? "SPEED" : "VITESSE"}
        </span>
        {speedOptions.map((opt) => (
          <button
            key={opt}
            onClick={() => onSpeedChange(opt)}
            style={{
              background: speed === opt ? palette.amberLamp : "transparent",
              color: speed === opt ? palette.ground : palette.ink,
              border: "none",
              borderRadius: 2,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: speed === opt ? 700 : 400,
              cursor: "pointer",
            }}
          >
            ×{opt}
          </button>
        ))}
      </div>
    );
  }
);

SpeedControl.displayName = "SpeedControl";

export default SpeedControl;
