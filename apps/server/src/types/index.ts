export interface SchedulePoint {
  fraction: number;
  time: number; // epoch ms
}

export interface VehicleState {
  tripId: string;
  lineId: string;
  /** Which of the line's real branches this specific train is running — lines fork
   *  (see PRODUCT.md), so the client needs this to pick the right polyline to evaluate
   *  the schedule's fractions against. */
  branchId: string;
  lineShortName: string;
  lineColor: string;
  lineLabelColor: string;
  certainty: "confirmed" | "predicted";
  /** Sorted by time, at least 2 points. The client evaluates position continuously from
   *  this rather than snapping only when a new message arrives — see PRODUCT.md. */
  schedule: SchedulePoint[];
}

/** IDFM's own three severities, normalized to a fixed set the client can style directly
 *  without knowing IDFM's French vocabulary — "blocking" (BLOQUANTE, service actually
 *  interrupted), "reduced" (PERTURBEE, degraded but running), "info" (INFORMATION, a
 *  heads-up rather than a real service impact). */
export type DisruptionSeverity = "blocking" | "reduced" | "info";

export interface DisruptionPeriod {
  /** Epoch ms — the client determines "is this active right now" itself, continuously,
   *  the same way it already treats vehicle positions as live rather than snapshotted. */
  begin: number;
  end: number;
}

export interface DisruptionState {
  id: string;
  lineId: string;
  severity: DisruptionSeverity;
  /** Concise label (IDFM's own shortMessage, e.g. "Stop not served") — the default,
   *  scannable view. Doesn't repeat the line name since the UI already groups by line. */
  shortTextFr: string;
  shortTextEn: string;
  /** Full official notice — shown on demand, not by default. */
  textFr: string;
  textEn: string;
  /** Empty means no known window — treated as always-active. */
  periods: DisruptionPeriod[];
}

// --- Raw IDFM API response shapes (idfmIngestion.ts parses these into the types above) ---

export interface EstimatedCall {
  StopPointRef?: { value?: string };
  ArrivalStopAssignment?: { ExpectedQuayRef?: { value?: string } };
  DepartureStopAssignment?: { ExpectedQuayRef?: { value?: string } };
  ExpectedArrivalTime?: string;
  ExpectedDepartureTime?: string;
  AimedArrivalTime?: string;
  AimedDepartureTime?: string;
}

export interface EstimatedVehicleJourney {
  LineRef?: { value?: string };
  DatedVehicleJourneyRef?: { value?: string };
  EstimatedCalls?: { EstimatedCall?: EstimatedCall[] };
}

export interface ResolvedCall {
  lngLat: [number, number];
  time: number;
}

export interface BulkDisruption {
  id: string;
  title?: string;
  message?: string;
  shortMessage?: string;
  severity?: string;
  applicationPeriods?: { begin?: string; end?: string }[];
  impactedSections?: { lineId?: string }[];
}
