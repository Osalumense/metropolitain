import { config } from "./config/index.js";
import { LIVE_LINES, LINE_BY_REF, quayLocation, type LineDefinition } from "./network.js";
import { translateToEnglish } from "./translate.js";
import type { VehicleState, DisruptionState, DisruptionSeverity, SchedulePoint } from "./types/index.js";

const BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace";

/**
 * Hard safety ceiling on real IDFM calls per day, independent of the polling interval
 * math in PRODUCT.md — a defensive backstop against a reconnect storm or a stuck retry
 * loop silently blowing through the quota while nobody's watching. Positions and
 * disruptions are tracked separately since they're different quota buckets.
 */
const MAX_POSITION_CALLS_PER_DAY = 1400;
// One call/cycle now (see fetchDisruptions — the bulk endpoint, not one call per line), so
// this is real headroom under IDFM's own 1,000/day quota for this endpoint, not just a
// number that happens not to trip. The previous "1400, 7 lines x this many cycles/day" cap
// was sized for a 7-line, one-call-per-line design; by the time we tracked 44 lines it was
// exhausting itself in the first ~62 minutes of every day (1400 / 44 lines ≈ 31 cycles),
// silently skipping disruption fetching for the rest of the day, every day — the real
// reason disruptions were never showing, confirmed directly against IDFM's real feed.
const MAX_DISRUPTION_CALLS_PER_DAY = 700;

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

  const res = await fetch(`${BASE_URL}/estimated-timetable`, { headers: { apikey: config.primApiKey } });
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

const DISRUPTIONS_BULK_URL = "https://prim.iledefrance-mobilites.fr/marketplace/disruptions_bulk/disruptions/v2";

/**
 * "line:IDFM:C01728" -> "C01728" -> our LineDefinition, by matching against the same bare
 * code embedded in lineRef ("STIF:Line::C01728:"). Built once from LIVE_LINES: this bulk
 * feed covers the whole network (buses included, ~900 disruptions at once), so most entries
 * won't match anything in here — that's expected, not a bug, since we only track rail/tram.
 */
const LINE_BY_BARE_CODE: Map<string, LineDefinition> = new Map(
  LIVE_LINES.map((l) => [l.lineRef.replace(/^STIF:Line::/, "").replace(/:$/, ""), l])
);

interface BulkDisruption {
  id: string;
  title?: string;
  message?: string;
  shortMessage?: string;
  severity?: string;
  applicationPeriods?: { begin?: string; end?: string }[];
  impactedSections?: { lineId?: string }[];
}

const HTML_ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The feed's `message` is HTML ("<p>…</p><br>…") — strip tags/entities for plain display text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#(\d+)|[a-z]+);/gi, (_, _whole, dec) =>
      dec ? String.fromCharCode(Number(dec)) : (HTML_ENTITY_MAP[_whole.toLowerCase()] ?? _whole)
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** IDFM's own three values (BLOQUANTE/PERTURBEE/INFORMATION), confirmed against the real
 *  feed — anything unrecognized falls back to "info" rather than overstating severity. */
function normalizeSeverity(raw: string | undefined): DisruptionSeverity {
  if (raw === "BLOQUANTE") return "blocking";
  if (raw === "PERTURBEE") return "reduced";
  return "info";
}

/**
 * "20260924T044500" is Europe/Paris wall-clock time (confirmed against real departure
 * times in the feed's own message text), not UTC and not ISO-8601 — parsed by first
 * reading the digits as if they were UTC, then correcting by however far Paris's *actual*
 * offset (which shifts with DST — CET vs CEST) puts it, rather than assuming a fixed
 * offset that would silently be wrong for half the year.
 */
function parseParisDateTime(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const guessAsUtc = Date.UTC(y, mo - 1, d, h, mi, se);
  const parisParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(guessAsUtc))
      .map((p) => [p.type, p.value])
  );
  const parisReadingAsUtc = Date.UTC(
    Number(parisParts.year),
    Number(parisParts.month) - 1,
    Number(parisParts.day),
    Number(parisParts.hour),
    Number(parisParts.minute),
    Number(parisParts.second)
  );
  return guessAsUtc - (parisReadingAsUtc - guessAsUtc);
}

export async function fetchDisruptions(): Promise<DisruptionState[]> {
  if (!disruptionBudget.tryConsume(MAX_DISRUPTION_CALLS_PER_DAY)) {
    console.warn("[idfm] daily disruption call budget exhausted, skipping this cycle");
    return [];
  }

  // Explicit, not left to whatever Node's fetch defaults to — confirmed the hard way: with
  // no Accept-Language header, curl (sends none at all) got French back, but Node's own
  // fetch got English (it apparently sends its own default based on the runtime/OS locale).
  // textFr must always genuinely be French, since translateToEnglish assumes a French
  // source — this pins it rather than trusting an ambient default that clearly isn't
  // consistent across HTTP clients.
  const res = await fetch(DISRUPTIONS_BULK_URL, { headers: { apiKey: config.primApiKey, "Accept-Language": "fr-FR" } });
  if (!res.ok) throw new Error(`disruptions_bulk ${res.status}`);
  const json = await res.json();
  const items: BulkDisruption[] = json?.disruptions ?? [];

  const disruptions: DisruptionState[] = [];
  for (const item of items) {
    const sections = item.impactedSections ?? [];
    // A single disruption can list the same line several times (one per affected direction
    // /segment) — dedupe before turning it into per-line entries.
    const lineIds = new Set(sections.map((s) => s.lineId).filter((x): x is string => !!x));
    if (lineIds.size === 0) continue; // no attributable line (e.g. bus-only, or network-wide)

    const textFr = stripHtml(item.message ?? item.title ?? item.shortMessage ?? "");
    if (!textFr) continue;
    const textEn = await translateToEnglish(textFr);
    // shortMessage is already concise ("Stop not served") — only fall back to stripping
    // the full message if it's somehow missing, never re-derive from the (line-name-
    // prefixed) title, since that would repeat the line name the UI already shows as the
    // group header.
    const shortTextFr = item.shortMessage ? stripHtml(item.shortMessage) : textFr;
    const shortTextEn = item.shortMessage ? await translateToEnglish(shortTextFr) : textEn;
    const severity: DisruptionSeverity = normalizeSeverity(item.severity);
    const periods = (item.applicationPeriods ?? [])
      .map((p) => ({ begin: p.begin ? parseParisDateTime(p.begin) : null, end: p.end ? parseParisDateTime(p.end) : null }))
      .filter((p): p is { begin: number; end: number } => p.begin !== null && p.end !== null);

    for (const rawLineId of lineIds) {
      const code = rawLineId.replace(/^line:IDFM:/, "");
      const line = LINE_BY_BARE_CODE.get(code);
      if (!line) continue; // a line we don't track (bus, etc.)
      disruptions.push({
        id: `${item.id}-${line.id}`,
        lineId: line.id,
        severity,
        shortTextFr,
        shortTextEn,
        textFr,
        textEn,
        periods,
      });
    }
  }
  return disruptions;
}
