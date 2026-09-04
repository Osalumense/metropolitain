import { LIVE_LINES, LINE_BY_ID } from "./network.js";
import { translateToEnglish } from "./translate.js";

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
  /** Empty means no known window — treated as always-active (matches the mock's own
   *  behavior, and any real disruption IDFM sends with no parseable period). */
  periods: DisruptionPeriod[];
}

interface SimTrain {
  tripId: string;
  lineId: string;
  branchId: string;
  fraction: number;
  speedPerSec: number; // fraction of line per second
  direction: 1 | -1;
  certainty: "confirmed" | "predicted";
}

const TRAINS_PER_LINE = 4;
const SCHEDULE_HORIZON_SEC = 180;
const SCHEDULE_STEP_SEC = 5;

const MOCK_DISRUPTION_MESSAGES = [
  "Trafic interrompu entre Chatelet et Nation en raison d'un incident voyageur.",
  "Ralentissements sur l'ensemble de la ligne suite a un probleme technique.",
  "Trafic retabli progressivement apres un incident d'exploitation.",
];

/** Simulates the bounce-at-the-ends motion forward in time to build a schedule the
 *  client can evaluate continuously, the same shape real IDFM-derived schedules use. */
function projectSchedule(startFraction: number, startDirection: 1 | -1, speedPerSec: number, startTime: number): SchedulePoint[] {
  const points: SchedulePoint[] = [];
  let fraction = startFraction;
  let direction = startDirection;
  for (let t = 0; t <= SCHEDULE_HORIZON_SEC; t += SCHEDULE_STEP_SEC) {
    fraction += speedPerSec * SCHEDULE_STEP_SEC * direction;
    if (fraction >= 1) {
      fraction = 1;
      direction = -1;
    } else if (fraction <= 0) {
      fraction = 0;
      direction = 1;
    }
    points.push({ fraction, time: startTime + t * 1000 });
  }
  return points;
}

/**
 * Stands in for the real IDFM Next Departures / Traffic Info ingestion loop
 * described in PRODUCT.md, so the rest of the pipeline (WebSocket, client
 * rendering, translation caching) can be built and tested before we have a
 * live PRIM API key. Not real transit data — never ship this.
 */
export class MockIngestion {
  private trains: SimTrain[] = [];
  private disruption: DisruptionState | null = null;
  private tickCount = 0;

  constructor() {
    for (const line of LIVE_LINES) {
      for (let i = 0; i < TRAINS_PER_LINE; i++) {
        const branch = line.branches[i % line.branches.length];
        this.trains.push({
          tripId: `${line.id}-mock-${i}`,
          lineId: line.id,
          branchId: branch.branchId,
          fraction: i / TRAINS_PER_LINE,
          speedPerSec: 0.0015 + Math.random() * 0.001,
          direction: Math.random() > 0.5 ? 1 : -1,
          // Most positions are predicted-only, per what we know of IDFM's real feed so far.
          certainty: Math.random() < 0.25 ? "confirmed" : "predicted",
        });
      }
    }
  }

  private advance() {
    this.tickCount++;
    // Roughly every 15 ticks, toggle a mock disruption so the ticker/pulse path gets exercised.
    if (this.tickCount % 15 === 0) {
      if (this.disruption) {
        this.disruption = null;
      } else {
        const line = LIVE_LINES[Math.floor(Math.random() * LIVE_LINES.length)];
        const textFr = MOCK_DISRUPTION_MESSAGES[Math.floor(Math.random() * MOCK_DISRUPTION_MESSAGES.length)];
        this.disruption = {
          id: `mock-${Date.now()}`,
          lineId: line.id,
          severity: "blocking",
          shortTextFr: "Trafic interrompu",
          shortTextEn: "Traffic interrupted",
          textFr,
          textEn: textFr,
          periods: [{ begin: Date.now() - 60_000, end: Date.now() + 15 * 60_000 }],
        };
      }
    }
  }

  async tick(): Promise<{ vehicles: VehicleState[]; disruptions: DisruptionState[] }> {
    this.advance();
    const now = Date.now();

    const vehicles: VehicleState[] = this.trains.map((t) => {
      const line = LINE_BY_ID.get(t.lineId)!;
      const schedule = projectSchedule(t.fraction, t.direction, t.speedPerSec, now);
      // Advance the train's own anchor state to where the schedule says "now" actually is,
      // so the next tick's projection starts from a consistent point.
      t.fraction = schedule[0].fraction;

      return {
        tripId: t.tripId,
        lineId: t.lineId,
        branchId: t.branchId,
        lineShortName: line.shortName,
        lineColor: line.color,
        lineLabelColor: line.textColor,
        certainty: t.certainty,
        schedule: [{ fraction: t.fraction, time: now }, ...schedule],
      };
    });

    const disruptions: DisruptionState[] = [];
    if (this.disruption) {
      this.disruption.textEn = await translateToEnglish(this.disruption.textFr);
      disruptions.push(this.disruption);
    }

    return { vehicles, disruptions };
  }
}
