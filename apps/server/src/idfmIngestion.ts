import { config } from "./config/index.js";
import { LIVE_LINES, LINE_BY_REF, quayLocation, type LineDefinition } from "./network.js";
import { translateToEnglish } from "./translate.js";
import type {
  VehicleState,
  DisruptionState,
  DisruptionSeverity,
  SchedulePoint,
  EstimatedCall,
  EstimatedVehicleJourney,
  ResolvedCall,
  BulkDisruption,
} from "./types/index.js";

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
export const extractQuayCode = (stopPointRef: string): string | null => {
  const parts = stopPointRef.split(":").filter(Boolean);
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : null;
};

/**
 * The precise quay-level reference. For rail/RER calls it lives in the stop assignment
 * (ArrivalStopAssignment/DepartureStopAssignment.ExpectedQuayRef) — the top-level
 * StopPointRef there is a coarser StopArea, not the quay, and resolves to nothing in our
 * quay cross-reference. For simpler modes (bus) StopPointRef is already the quay ref.
 */
const callQuayRef = (call: EstimatedCall): string | null => {
  return (
    call.ArrivalStopAssignment?.ExpectedQuayRef?.value ??
    call.DepartureStopAssignment?.ExpectedQuayRef?.value ??
    call.StopPointRef?.value ??
    null
  );
};

const callTime = (call: EstimatedCall, which: "arrival" | "departure"): number | null => {
  const t =
    which === "arrival"
      ? call.ExpectedArrivalTime ?? call.AimedArrivalTime
      : call.ExpectedDepartureTime ?? call.AimedDepartureTime;
  return t ? Date.parse(t) : null;
};

/**
 * Keeps only the longest run (in time order) that's consistently monotonic in one
 * direction along the branch, trying both directions and keeping whichever fits more
 * points — a delayed or last-of-night journey can carry stale predicted times for stops
 * it's already passed alongside fresh ones for stops still ahead (confirmed live: a
 * delayed last Métro 8 run whose call list interleaved already-passed western stations'
 * old times with the current eastern ones). Each stale point still resolves close to the
 * real track — config.maxCallDistanceMeters alone can't catch it — but it breaks the one
 * property a real, single train's schedule always has: fraction moves the same direction
 * throughout. O(n²), fine at this scale (a handful to a few dozen calls per journey).
 */
export const longestMonotonicRun = (points: SchedulePoint[]): SchedulePoint[] => {
  if (points.length < 3) return points;

  const longestRun = (nonDecreasing: boolean): SchedulePoint[] => {
    const bestLength = new Array<number>(points.length).fill(1);
    const predecessor = new Array<number>(points.length).fill(-1);
    for (let i = 1; i < points.length; i++) {
      for (let j = 0; j < i; j++) {
        const fits = nonDecreasing ? points[j].fraction <= points[i].fraction : points[j].fraction >= points[i].fraction;
        if (fits && bestLength[j] + 1 > bestLength[i]) {
          bestLength[i] = bestLength[j] + 1;
          predecessor[i] = j;
        }
      }
    }
    let end = 0;
    for (let i = 1; i < points.length; i++) if (bestLength[i] > bestLength[end]) end = i;
    const run: SchedulePoint[] = [];
    for (let i = end; i !== -1; i = predecessor[i]) run.unshift(points[i]);
    return run;
  };

  const increasing = longestRun(true);
  const decreasing = longestRun(false);
  return increasing.length >= decreasing.length ? increasing : decreasing;
};

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
const scheduleFromCalls = (line: LineDefinition, calls: EstimatedCall[]): { schedule: SchedulePoint[]; branchId: string } | null => {
  const resolved: ResolvedCall[] = [];
  // IDFM intermittently repeats the same physical stop twice in one journey's call list
  // (confirmed live 2026-09-23: two entries for the same quay, each with a slightly
  // different predicted time) — each copy is individually plausible, but sorting the
  // combined list by time interleaves them, which reads on screen as the vehicle darting
  // forward and back between two near-simultaneous predictions for the same stop. A real
  // journey only visits a given quay once, so only the first (freshest, per SIRI's own
  // update-in-place convention) occurrence is trustworthy.
  const seenQuays = new Set<string>();
  for (const c of calls) {
    const quayRef = callQuayRef(c);
    const quay = quayRef ? extractQuayCode(quayRef) : null;
    if (quay) {
      if (seenQuays.has(quay)) continue;
      seenQuays.add(quay);
    }
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

  // A call whose real quay sits nowhere near the winning branch's own geometry isn't a
  // fork/offset rounding error — it means this stop's track isn't covered by any branch
  // we loaded for this line (confirmed on RER D: a real branch variant through
  // Brunoy/Yerres missing from the registry). "Nearest point" still returns *a* fraction
  // in that case, just a wrong, far-away one, which would otherwise make the vehicle
  // marker jump backward on screen before the next real point corrects it. Dropping the
  // call is strictly better than keeping a wrong position — see config.maxCallDistanceMeters.
  const distanceFiltered: SchedulePoint[] = resolved
    .map((r, i) => ({ fraction: bestResults[i].fraction, time: r.time, distanceMeters: bestResults[i].distanceMeters }))
    .filter((p) => p.distanceMeters <= config.maxCallDistanceMeters)
    .map(({ fraction, time }) => ({ fraction, time }))
    .sort((a, b) => a.time - b.time);

  return { schedule: longestMonotonicRun(distanceFiltered), branchId: bestBranch.branchId };
};

export const fetchVehicles = async (): Promise<VehicleState[]> => {
  if (!positionBudget.tryConsume(config.maxPositionCallsPerDay)) {
    console.warn("[idfm] daily position call budget exhausted, skipping this cycle");
    return [];
  }

  const res = await fetch(`${config.primBaseUrl}/estimated-timetable`, { headers: { apikey: config.primApiKey } });
  if (!res.ok) throw new Error(`estimated-timetable ${res.status}`);
  const json = await res.json();

  const frames = json?.Siri?.ServiceDelivery?.EstimatedTimetableDelivery?.[0]?.EstimatedJourneyVersionFrame ?? [];
  const journeys: EstimatedVehicleJourney[] = frames.flatMap((f: { EstimatedVehicleJourney?: EstimatedVehicleJourney[] }) => f.EstimatedVehicleJourney ?? []);

  const vehicles: VehicleState[] = [];
  const now = Date.now();

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
        if (result) {
          const { schedule, branchId } = result;
          // IDFM publishes predicted times well before a journey actually starts, and
          // doesn't necessarily drop one the instant it finishes — the feed alone doesn't
          // say "this train is in service right now". A single resolved call can't be
          // interpolated between (there's nothing to interpolate — it's one point), and a
          // journey whose entire predicted window is still ahead of or already behind the
          // current moment isn't a train anyone would actually see moving. Without this, a
          // quiet network (the small hours, the last runs finished, the first runs not yet
          // started) still renders as if every line were running normally.
          const first = schedule[0]?.time;
          const last = schedule[schedule.length - 1]?.time;
          const isCurrentlyRunning = schedule.length >= 2 && first !== undefined && last !== undefined && now >= first && now <= last;
          if (isCurrentlyRunning) {
            vehicles.push({
              tripId: journey.DatedVehicleJourneyRef?.value ?? `${line.id}-${Math.random()}`,
              lineId: line.id,
              branchId,
              lineShortName: line.shortName,
              lineColor: line.color,
              lineLabelColor: line.textColor,
              certainty: "predicted", // this feed never carries raw GPS — see PRODUCT.md
              schedule,
            });
          }
        }
      }
    }

    if (++sinceYield >= YIELD_EVERY) {
      sinceYield = 0;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return vehicles;
};

/**
 * "line:IDFM:C01728" -> "C01728" -> our LineDefinition, by matching against the same bare
 * code embedded in lineRef ("STIF:Line::C01728:"). Built once from LIVE_LINES: this bulk
 * feed covers the whole network (buses included, ~900 disruptions at once), so most entries
 * won't match anything in here — that's expected, not a bug, since we only track rail/tram.
 */
const LINE_BY_BARE_CODE: Map<string, LineDefinition> = new Map(
  LIVE_LINES.map((l) => [l.lineRef.replace(/^STIF:Line::/, "").replace(/:$/, ""), l])
);

const HTML_ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The feed's `message` is HTML ("<p>…</p><br>…") — strip tags/entities for plain display text. */
export const stripHtml = (html: string): string => {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#(\d+)|[a-z]+);/gi, (_, _whole, dec) =>
      dec ? String.fromCharCode(Number(dec)) : (HTML_ENTITY_MAP[_whole.toLowerCase()] ?? _whole)
    )
    .replace(/\s+/g, " ")
    .trim();
};

/** IDFM's own three values (BLOQUANTE/PERTURBEE/INFORMATION), confirmed against the real
 *  feed — anything unrecognized falls back to "info" rather than overstating severity. */
export const normalizeSeverity = (raw: string | undefined): DisruptionSeverity => {
  if (raw === "BLOQUANTE") return "blocking";
  if (raw === "PERTURBEE") return "reduced";
  return "info";
};

/**
 * "20260924T044500" is Europe/Paris wall-clock time (confirmed against real departure
 * times in the feed's own message text), not UTC and not ISO-8601 — parsed by first
 * reading the digits as if they were UTC, then correcting by however far Paris's *actual*
 * offset (which shifts with DST — CET vs CEST) puts it, rather than assuming a fixed
 * offset that would silently be wrong for half the year.
 */
export const parseParisDateTime = (s: string): number | null => {
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
};

export const fetchDisruptions = async (): Promise<DisruptionState[]> => {
  if (!disruptionBudget.tryConsume(config.maxDisruptionCallsPerDay)) {
    console.warn("[idfm] daily disruption call budget exhausted, skipping this cycle");
    return [];
  }

  // Explicit, not left to whatever Node's fetch defaults to — confirmed the hard way: with
  // no Accept-Language header, curl (sends none at all) got French back, but Node's own
  // fetch got English (it apparently sends its own default based on the runtime/OS locale).
  // textFr must always genuinely be French, since translateToEnglish assumes a French
  // source — this pins it rather than trusting an ambient default that clearly isn't
  // consistent across HTTP clients.
  const res = await fetch(config.disruptionsBulkUrl, { headers: { apiKey: config.primApiKey, "Accept-Language": "fr-FR" } });
  if (!res.ok) throw new Error(`disruptions_bulk ${res.status}`);
  const json = await res.json();
  const items: BulkDisruption[] = json?.disruptions ?? [];

  // 1. Pre-filter only disruptions impacting lines we actually track (rail, RER, tramway),
  // discarding bus-only disruptions (~80% of bulk feed) BEFORE touching translation.
  const relevantItems: { item: BulkDisruption; lines: LineDefinition[]; textFr: string; shortTextFr: string }[] = [];
  const textsToTranslate = new Set<string>();

  for (const item of items) {
    const sections = item.impactedSections ?? [];
    const lineIds = new Set(sections.map((s) => s.lineId).filter((x): x is string => !!x));
    if (lineIds.size === 0) continue;

    const matchingLines: LineDefinition[] = [];
    for (const rawLineId of lineIds) {
      const code = rawLineId.replace(/^line:IDFM:/, "");
      const line = LINE_BY_BARE_CODE.get(code);
      if (line) matchingLines.push(line);
    }
    if (matchingLines.length === 0) continue; // bus-only or network-wide untracked service

    const textFr = stripHtml(item.message ?? item.title ?? item.shortMessage ?? "");
    if (!textFr) continue;
    const shortTextFr = item.shortMessage ? stripHtml(item.shortMessage) : textFr;

    textsToTranslate.add(textFr);
    if (shortTextFr !== textFr) {
      textsToTranslate.add(shortTextFr);
    }

    relevantItems.push({ item, lines: matchingLines, textFr, shortTextFr });
  }

  // 2. Translate unique texts with modest concurrency so rate limits and pacing are respected.
  const translations = new Map<string, string>();
  const textArray = [...textsToTranslate];
  const BATCH_SIZE = 5;
  for (let i = 0; i < textArray.length; i += BATCH_SIZE) {
    const chunk = textArray.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(chunk.map(async (text) => [text, await translateToEnglish(text)] as const));
    for (const [fr, en] of results) {
      translations.set(fr, en);
    }
  }

  // 3. Assemble DisruptionState entries for all tracked lines.
  const disruptions: DisruptionState[] = [];
  for (const { item, lines, textFr, shortTextFr } of relevantItems) {
    const textEn = translations.get(textFr) ?? textFr;
    const shortTextEn = translations.get(shortTextFr) ?? (shortTextFr === textFr ? textEn : shortTextFr);
    const severity: DisruptionSeverity = normalizeSeverity(item.severity);
    const periods = (item.applicationPeriods ?? [])
      .map((p) => ({ begin: p.begin ? parseParisDateTime(p.begin) : null, end: p.end ? parseParisDateTime(p.end) : null }))
      .filter((p): p is { begin: number; end: number } => p.begin !== null && p.end !== null);

    for (const line of lines) {
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
};
