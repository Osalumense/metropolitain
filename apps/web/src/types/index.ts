export interface SchedulePoint {
  fraction: number;
  time: number; // epoch ms
}

export interface Vehicle {
  tripId: string;
  lineId: string;
  /** Which real branch this train is on (lines fork) — determines which polyline its
   *  schedule's fractions resolve against. */
  branchId: string;
  lineShortName: string;
  lineColor: string;
  lineLabelColor: string;
  certainty: "confirmed" | "predicted";
  schedule: SchedulePoint[];
}

/** Vehicle plus the client-only bookkeeping needed to play its real schedule back at an
 *  adjustable pace. virtualAnchorTime/realAnchorTime together let the speed change live
 *  without a visible jump. */
export interface TrackedVehicle extends Vehicle {
  virtualAnchorTime: number;
  realAnchorTime: number;
}

export type DisruptionSeverity = "blocking" | "reduced" | "info";

export interface DisruptionPeriod {
  begin: number;
  end: number;
}

export interface Disruption {
  id: string;
  lineId: string;
  severity: DisruptionSeverity;
  shortTextFr: string;
  shortTextEn: string;
  textFr: string;
  textEn: string;
  periods: DisruptionPeriod[];
}

export type ThemeMode = "light" | "dark" | "auto";

export interface TourStepDef {
  /** Which element to spotlight — null for the intro step, which has no single target. */
  ref: "speed" | "themeLang" | "disruption" | "lines" | null;
  titleFr: string;
  titleEn: string;
  bodyFr: string;
  bodyEn: string;
}

export interface LineMeta {
  color: string;
  textColor: string;
  shortName: string;
  mode: string;
}
