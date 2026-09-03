import { LIVE_LINES, LINE_BY_REF, quayLocation, type LineDefinition } from "./network.js";
import { translateToEnglish } from "./translate.js";
import type { VehicleState, DisruptionState, SchedulePoint } from "./mockIngestion.js";

const BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace";

/**
 * Hard safety ceiling on real IDFM calls per day, independent of the polling interval
 * math in PRODUCT.md — a defensive backstop against a reconnect storm or a stuck retry
 * loop silently blowing through the quota while nobody's watching. Positions and
 * disruptions are tracked separately since they're different quota buckets.
 */
const MAX_POSITION_CALLS_PER_DAY = 1400;
const MAX_DISRUPTION_CALLS_PER_DAY = 1400; // 7 lines x this many cycles/day

class DailyBudget {
  private count = 0;
  private day = new Date().toDateString();

  private rollIfNewDay() {
    const today = new Date().toDateString();
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
  }

  tryConsume(max: number, n = 1): boolean {
    this.rollIfNewDay();
    if (this.count + n > max) return false;
    this.count += n;
    return true;
  }
}

const positionBudget = new DailyBudget();
const disruptionBudget = new DailyBudget();

function apiKey(): string {
  const key = process.env.PRIM_API_KEY;
  if (!key) throw new Error("PRIM_API_KEY not set");
  return key;
}

/** "STIF:StopPointRef:Q:24859:" (or similar) -> "24859" */
function extractQuayCode(stopPointRef: string): string | null {
  const parts = stopPointRef.split(":").filter(Boolean);
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : null;
}

interface EstimatedCall {
  StopPointRef?: { value?: string };
  ArrivalStopAssignment?: { ExpectedQuayRef?: { value?: string } };
  DepartureStopAssignment?: { ExpectedQuayRef?: { value?: string } };
  ExpectedArrivalTime?: string;
  ExpectedDepartureTime?: string;
  AimedArrivalTime?: string;
  AimedDepartureTime?: string;
}

/**
 * The precise quay-level reference. For rail/RER calls it lives in the stop assignment
 * (ArrivalStopAssignment/DepartureStopAssignment.ExpectedQuayRef) — the top-level
 * StopPointRef there is a coarser StopArea, not the quay, and resolves to nothing in our
 * quay cross-reference. For simpler modes (bus) StopPointRef is already the quay ref.
 */
function callQuayRef(call: EstimatedCall): string | null {
  return (
    call.ArrivalStopAssignment?.ExpectedQuayRef?.value ??
    call.DepartureStopAssignment?.ExpectedQuayRef?.value ??
    call.StopPointRef?.value ??
    null
  );
}

interface EstimatedVehicleJourney {
  LineRef?: { value?: string };
  DatedVehicleJourneyRef?: { value?: string };
  EstimatedCalls?: { EstimatedCall?: EstimatedCall[] };
}

function callTime(call: EstimatedCall, which: "arrival" | "departure"): number | null {
  const t =
    which === "arrival"
      ? call.ExpectedArrivalTime ?? call.AimedArrivalTime
      : call.ExpectedDepartureTime ?? call.AimedDepartureTime;
  return t ? Date.parse(t) : null;
}

interface ResolvedCall {
  lngLat: [number, number];
  time: number;
}

/**
 * Turns one journey's ordered stop-time predictions into a schedule of (fraction, time)
 * points the client can evaluate continuously — resolving each call to real coordinates
 * via the quay cross-reference. No raw GPS exists in this feed at all, so this real
 * predicted-times table *is* the position data; the client interpolates between whichever
 * two points bracket the current moment, every frame, rather than only at poll time.
 *
 * Lines that fork (every RER/Transilien line) have several real branches — this picks
 * whichever branch's track the journey's own resolved stops actually sit closest to
 * (summed distance across every resolved call, lowest wins), rather than assuming one.
 * A journey on the wrong branch would otherwise interpolate onto a track it never runs on.
 */
function scheduleFromCalls(line: LineDefinition, calls: EstimatedCall[]): { schedule: SchedulePoint[]; branchId: string } | null {
  const resolved: ResolvedCall[] = [];
  for (const c of calls) {
    const quayRef = callQuayRef(c);
    const quay = quayRef ? extractQuayCode(quayRef) : null;
    const loc = quay ? quayLocation(quay) : undefined;
    if (!loc) continue;
    const time = callTime(c, "arrival") ?? callTime(c, "departure");
    if (time === null) continue;
    resolved.push({ lngLat: [loc.lon, loc.lat], time });
  }
  if (resolved.length === 0) return null;

  // Score every branch in one pass, keeping each call's {fraction, distance} as we go —
  // the winning branch's points are then already computed, no need to scan its polyline
  // a second time (this loop is the hot path of a poll cycle: branches x calls x vertices).
  let bestBranch = line.branches[0];
  let bestScore = Infinity;
  let bestResults: { fraction: number; distanceMeters: number }[] = [];
  for (const branch of line.branches) {
    let score = 0;
    const results = resolved.map((r) => branch.polyline.nearestFractionAndDistance(r.lngLat));
    for (const res of results) score += res.distanceMeters;
    if (score < bestScore) {
      bestScore = score;
      bestBranch = branch;
      bestResults = results;
    }
  }

  const points: SchedulePoint[] = resolved
    .map((r, i) => ({ fraction: bestResults[i].fraction, time: r.time }))
    .sort((a, b) => a.time - b.time);

  return { schedule: points, branchId: bestBranch.branchId };
}

export async function fetchVehicles(): Promise<VehicleState[]> {
  if (!positionBudget.tryConsume(MAX_POSITION_CALLS_PER_DAY)) {
    console.warn("[idfm] daily position call budget exhausted, skipping this cycle");
    return [];
  }

  const res = await fetch(`${BASE_URL}/estimated-timetable`, { headers: { apikey: apiKey() } });
  if (!res.ok) throw new Error(`estimated-timetable ${res.status}`);
  const json = await res.json();

  const frames = json?.Siri?.ServiceDelivery?.EstimatedTimetableDelivery?.[0]?.EstimatedJourneyVersionFrame ?? [];
  const journeys: EstimatedVehicleJourney[] = frames.flatMap((f: { EstimatedVehicleJourney?: EstimatedVehicleJourney[] }) => f.EstimatedVehicleJourney ?? []);

  const vehicles: VehicleState[] = [];

  // Branch-matching (scheduleFromCalls) is real CPU work — hundreds of journeys x several
  // branches x calls, each scanning a polyline. Run entirely synchronously, this would
  // block the event loop (and every other request/WS message) for the whole pass; yielding
  // every YIELD_EVERY journeys lets Node service other work interleaved instead.
  const YIELD_EVERY = 40;
  let sinceYield = 0;

  for (const journey of journeys) {
    const lineRef = journey.LineRef?.value;
    const line = lineRef ? LINE_BY_REF.get(lineRef) : undefined;
    if (line) {
      const calls = journey.EstimatedCalls?.EstimatedCall ?? [];
      if (calls.length > 0) {
        const result = scheduleFromCalls(line, calls);
        if (result && result.schedule.length > 0) {
          vehicles.push({
            tripId: journey.DatedVehicleJourneyRef?.value ?? `${line.id}-${Math.random()}`,
            lineId: line.id,
            branchId: result.branchId,
            lineShortName: line.shortName,
            lineColor: line.color,
            lineLabelColor: line.textColor,
            certainty: "predicted", // this feed never carries raw GPS — see PRODUCT.md
            schedule: result.schedule,
          });
        }
      }
    }

    if (++sinceYield >= YIELD_EVERY) {
      sinceYield = 0;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return vehicles;
}

interface InfoMessage {
  Content?: { Message?: { MessageType?: string; MessageText?: { value?: string; lang?: string } }[] };
}

/** Prefers the concise SHORT_MESSAGE variant (ticker-appropriate) over TEXT_ONLY. */
function extractMessageText(msg: InfoMessage): string | null {
  const messages = msg.Content?.Message ?? [];
  const short = messages.find((m) => m.MessageType === "SHORT_MESSAGE");
  const text = short?.MessageText?.value ?? messages[0]?.MessageText?.value;
  return text ?? null;
}

export async function fetchDisruptions(): Promise<DisruptionState[]> {
  if (!disruptionBudget.tryConsume(MAX_DISRUPTION_CALLS_PER_DAY, LIVE_LINES.length)) {
    console.warn("[idfm] daily disruption call budget exhausted, skipping this cycle");
    return [];
  }

  const disruptions: DisruptionState[] = [];
  for (const line of LIVE_LINES) {
    try {
      const res = await fetch(`${BASE_URL}/general-message?LineRef=${encodeURIComponent(line.lineRef)}`, {
        headers: { apikey: apiKey() },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const messages: InfoMessage[] = json?.Siri?.ServiceDelivery?.GeneralMessageDelivery?.[0]?.InfoMessage ?? [];
      for (const m of messages) {
        const textFr = extractMessageText(m);
        if (!textFr) continue;
        disruptions.push({
          id: `${line.id}-${textFr.slice(0, 40)}`,
          lineId: line.id,
          textFr,
          textEn: await translateToEnglish(textFr),
        });
      }
    } catch (err) {
      console.error(`[idfm] general-message failed for ${line.id}:`, err);
    }
  }
  return disruptions;
}
