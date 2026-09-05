"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { themes, type ThemePalette } from "@/lib/theme";
import { Polyline, type LngLat } from "@/lib/polyline";
import { config } from "@/config";

const API_URL = config.apiUrl;
const WS_URL = config.wsUrl;

/**
 * Our own backend, unlike the third-party base-map tiles, is infrastructure we control end
 * to end — there's no real product without this data, so unlike the tiles it's fine (and
 * correct) to bound it: an 8s timeout, one retry, then surface a real error instead of
 * spinning forever.
 */
const fetchNetworkWithRetry = async (): Promise<GeoJSON.FeatureCollection> => {
  const attempt = async (): Promise<GeoJSON.FeatureCollection> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API_URL}/api/network`, { signal: controller.signal });
      if (!res.ok) throw new Error(`/api/network responded ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    return await attempt();
  } catch {
    return await attempt();
  }
};

interface SchedulePoint {
  fraction: number;
  time: number; // epoch ms
}

interface Vehicle {
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
 *  without a visible jump — see changeSpeed. */
interface TrackedVehicle extends Vehicle {
  virtualAnchorTime: number;
  realAnchorTime: number;
}

type DisruptionSeverity = "blocking" | "reduced" | "info";

interface DisruptionPeriod {
  begin: number;
  end: number;
}

interface Disruption {
  id: string;
  lineId: string;
  severity: DisruptionSeverity;
  shortTextFr: string;
  shortTextEn: string;
  textFr: string;
  textEn: string;
  periods: DisruptionPeriod[];
}

/** No known window (empty periods) is treated as always-active — matches the server's own
 *  DisruptionState convention. */
const isDisruptionActiveNow = (d: Disruption, now: number): boolean => {
  return d.periods.length === 0 || d.periods.some((p) => now >= p.begin && now <= p.end);
};

const SEVERITY_RANK: Record<DisruptionSeverity, number> = { blocking: 2, reduced: 1, info: 0 };

/**
 * Real train speed, watched live, is imperceptible — a ~2min gap between predicted stops
 * reads as a few pixels of drift a minute, not "moving." Default is 1x (strictly real —
 * the honest baseline); the viewer can opt into faster playback themselves, which is
 * disclosed on-page rather than silently sped up. Either way the underlying data is
 * exactly what IDFM predicted — only the pacing changes, the way a time-lapse works.
 */
const SPEED_OPTIONS = [1, 2, 4, 8] as const;
const DEFAULT_SPEED = 1;

type ThemeMode = "light" | "dark" | "auto";
const DEFAULT_THEME_MODE: ThemeMode = "dark"; // the tested, primary Guimard's Ironwork identity

/** Must match the transform transition's duration below — the unmount timer waits for it. */
const CURTAIN_DURATION_MS = 900;

const TOUR_SEEN_KEY = "metropolitain_tour_seen";

interface TourStepDef {
  /** Which element to spotlight — null for the intro step, which has no single target. */
  ref: "speed" | "themeLang" | "disruption" | null;
  titleFr: string;
  titleEn: string;
  bodyFr: string;
  bodyEn: string;
}

const TOUR_STEPS: TourStepDef[] = [
  {
    ref: null,
    titleFr: "Bienvenue sur Métropolitain",
    titleEn: "Welcome to Métropolitain",
    bodyFr:
      "Vous regardez les trains du métro, RER, Transilien et tramway d'Île-de-France se déplacer en temps réel, à partir de données réelles.",
    bodyEn: "You're watching Paris's Métro, RER, Transilien, and tram trains move in real time, from real live data.",
  },
  {
    ref: "speed",
    titleFr: "Vitesse réelle par défaut",
    titleEn: "Real speed by default",
    bodyFr:
      "×1 est la vitesse réelle des trains — souvent trop lente pour être visible à l'échelle de la ville. Accélérez pour mieux voir le mouvement.",
    bodyEn: "×1 is real train speed — often too slow to notice at city scale. Speed up to see the movement more clearly.",
  },
  {
    ref: "themeLang",
    titleFr: "Thème et langue",
    titleEn: "Theme and language",
    bodyFr: "Passez du mode sombre au mode clair, ou basculez entre français et anglais, à tout moment.",
    bodyEn: "Switch between dark and light mode, or between French and English, anytime.",
  },
  {
    ref: "disruption",
    titleFr: "Perturbations en direct",
    titleEn: "Live disruptions",
    bodyFr: "Cet indicateur affiche les perturbations de trafic en cours, ligne par ligne.",
    bodyEn: "This shows current service disruptions, line by line.",
  },
];

/**
 * Where a vehicle actually is *right now*, continuously — not just at the last poll.
 * Finds whichever two schedule points bracket the accelerated virtual time and interpolates
 * between them. Once virtual time runs past the last known real point (which happens often,
 * since acceleration burns through a ~90s poll's worth of real schedule in ~11s), it keeps
 * moving by extrapolating forward at the rate implied by the last known segment, rather than
 * freezing — clamped so it never runs off the end of the actual track.
 */
const fractionAt = (schedule: SchedulePoint[], virtualNow: number): number => {
  if (schedule.length === 0) return 0;
  if (virtualNow <= schedule[0].time) return schedule[0].fraction;

  for (let i = 1; i < schedule.length; i++) {
    if (schedule[i].time >= virtualNow) {
      const a = schedule[i - 1];
      const b = schedule[i];
      const span = b.time - a.time;
      const t = span > 0 ? (virtualNow - a.time) / span : 0;
      return a.fraction + (b.fraction - a.fraction) * t;
    }
  }

  if (schedule.length === 1) return schedule[0].fraction;
  const a = schedule[schedule.length - 2];
  const b = schedule[schedule.length - 1];
  const rate = b.time > a.time ? (b.fraction - a.fraction) / (b.time - a.time) : 0;
  const extrapolated = b.fraction + rate * (virtualNow - b.time);
  return Math.max(0, Math.min(1, extrapolated));
};

const vehiclesToGeoJSON = (vehicles: TrackedVehicle[], lineGeometry: Map<string, Polyline>, now: number, speed: number): GeoJSON.FeatureCollection => {
  return {
    type: "FeatureCollection",
    features: vehicles
      .map((v) => {
        const polyline = lineGeometry.get(v.branchId);
        if (!polyline) return null;
        const virtualNow = v.virtualAnchorTime + (now - v.realAnchorTime) * speed;
        const fraction = fractionAt(v.schedule, virtualNow);
        const { position, bearing } = polyline.pointAtFraction(fraction);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: position },
          properties: {
            tripId: v.tripId,
            lineId: v.lineId,
            lineShortName: v.lineShortName,
            lineColor: v.lineColor,
            lineLabelColor: v.lineLabelColor,
            bearing,
            certainty: v.certainty,
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null),
  };
};

// Our own layers (added after this runs the first time) must never be touched by the
// base-map restyle below — network-lines is type "line" and vehicles-label is type
// "symbol", so a naive type-only match re-applying on a theme switch would stomp their
// data-driven per-line color expressions with flat base-map colors.
const OWN_LAYER_IDS = new Set(["network-lines", "network-stations", "vehicles-glow", "vehicles-badge", "vehicles-label"]);

/** Applies the resolved palette to the base map's own layers (background/land/water/roads/
 *  labels) — called once at load and again whenever the theme changes, so switching
 *  light/dark/auto re-styles the already-loaded map instead of needing a reload. */
const applyMapTheme = (map: MapLibreMap, t: ThemePalette) => {
  const style = map.getStyle();
  for (const layer of style.layers) {
    if (OWN_LAYER_IDS.has(layer.id)) continue;
    if (layer.type === "background") {
      map.setPaintProperty(layer.id, "background-color", t.ground);
    } else if (layer.type === "fill" && !layer.id.includes("water")) {
      map.setPaintProperty(layer.id, "fill-color", t.ground);
      map.setPaintProperty(layer.id, "fill-opacity", 0.6);
    } else if (layer.type === "fill" && layer.id.includes("water")) {
      map.setPaintProperty(layer.id, "fill-color", t.verdigris);
      map.setPaintProperty(layer.id, "fill-opacity", 0.25);
    } else if (layer.type === "line") {
      map.setPaintProperty(layer.id, "line-color", t.bronze);
      map.setPaintProperty(layer.id, "line-opacity", 0.35);
    } else if (layer.type === "symbol") {
      map.setPaintProperty(layer.id, "text-color", t.ink);
      map.setPaintProperty(layer.id, "text-halo-color", t.ground);
      map.setPaintProperty(layer.id, "text-opacity", 0.4);
    }
  }
  if (map.getLayer("network-stations")) {
    map.setPaintProperty("network-stations", "circle-stroke-color", t.ground);
  }
};

const MetroMap = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehiclesRef = useRef<Map<string, TrackedVehicle>>(new Map());
  const lineGeometryRef = useRef<Map<string, Polyline>>(new Map());
  /** lineId -> its own badge styling, read straight off the already-fetched network data
   *  (every feature is stamped with its line's color/text_color/short_name server-side —
   *  see network.ts) rather than keeping a second copy of the line registry client-side. */
  const lineMetaRef = useRef<Map<string, { color: string; textColor: string; shortName: string }>>(new Map());
  const speedRef = useRef<number>(DEFAULT_SPEED);
  const [disruptions, setDisruptions] = useState<Disruption[]>([]);
  const [lang, setLang] = useState<"en" | "fr">("fr");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Curtain reveal: `loading` flips false the instant data is ready, but the overlay
  // stays mounted a moment longer so the parting animation is actually visible rather
  // than an instant cut. `curtainOpen` drives the transform (set one frame after loading
  // clears, so the initial closed state paints first and the transition is guaranteed to
  // run); `overlayMounted` unmounts the panels once that transition has finished.
  const [curtainOpen, setCurtainOpen] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [disruptionsOpen, setDisruptionsOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [expandedDisruptionId, setExpandedDisruptionId] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);

  // First-load tour: null = not showing (either not started yet, or finished/skipped).
  // 0..TOUR_STEPS.length-1 = which step is active. Persisted in localStorage so it only
  // ever shows once per visitor, not on every reload.
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourRect, setTourRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const speedControlRef = useRef<HTMLDivElement>(null);
  const themeLangRef = useRef<HTMLDivElement>(null);
  const disruptionBadgeRef = useRef<HTMLButtonElement>(null);

  const isDark = themeMode === "auto" ? systemPrefersDark : themeMode === "dark";
  const t = isDark ? themes.dark : themes.light;
  const panelBg = isDark ? "rgba(28,26,22,0.75)" : "rgba(232,226,212,0.85)";
  const panelBgSolid = isDark ? "rgba(20,19,16,0.97)" : "rgba(232,226,212,0.97)";

  // Disruptions: split into "active right now" (drives the badge) vs "scheduled/upcoming"
  // (context, not urgency) — most of what IDFM reports at any moment is planned future
  // works, not something happening this instant, so treating all of it as equally urgent
  // was the actual problem with the old flat "160 perturbations" badge, not just its styling.
  const disruptionsNow = Date.now();
  const activeDisruptions = disruptions.filter((d) => isDisruptionActiveNow(d, disruptionsNow));
  const upcomingDisruptions = disruptions.filter((d) => !isDisruptionActiveNow(d, disruptionsNow));
  const activeLineIds = new Set(activeDisruptions.map((d) => d.lineId));
  const worstActiveSeverity = activeDisruptions.reduce<DisruptionSeverity | null>(
    (worst, d) => (worst === null || SEVERITY_RANK[d.severity] > SEVERITY_RANK[worst] ? d.severity : worst),
    null
  );
  const groupDisruptionsByLine = (list: Disruption[]): [string, Disruption[]][] => {
    const map = new Map<string, Disruption[]>();
    for (const d of list) map.set(d.lineId, [...(map.get(d.lineId) ?? []), d]);
    return [...map.entries()];
  };
  const activeByLine = groupDisruptionsByLine(activeDisruptions);
  const upcomingByLine = groupDisruptionsByLine(upcomingDisruptions);
  const severityColor = (sev: DisruptionSeverity): string => {
    return sev === "blocking" ? t.disruption : sev === "reduced" ? t.amberLamp : t.ink;
  };
  /** Compact period label ("Today 10pm–11pm", "Sep 21–Oct 2") from the nearest upcoming
   *  window — enough to place it in time without repeating the prose already in the text. */
  const formatPeriod = (d: Disruption): string | null => {
    const now = disruptionsNow;
    const period = d.periods.find((p) => now <= p.end) ?? d.periods[0];
    if (!period) return null;
    const fmt = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const isToday = new Date(period.begin).toDateString() === new Date(now).toDateString();
    if (isToday && period.begin <= now) {
      const endFmt = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });
      return `${lang === "en" ? "Until" : "Jusqu'à"} ${endFmt.format(period.end)}`;
    }
    return fmt.format(period.begin);
  };

  // Drives the curtain reveal once loading clears: waits a frame (so the closed state
  // paints first and the transform transition is guaranteed to fire), starts the parting
  // animation, then unmounts the overlay once it's finished playing.
  useEffect(() => {
    if (loading) return;
    const raf = requestAnimationFrame(() => setCurtainOpen(true));
    const unmount = setTimeout(() => setOverlayMounted(false), CURTAIN_DURATION_MS + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(unmount);
    };
  }, [loading]);

  // First-load tour: starts once the curtain has finished opening (never competes with it
  // for attention), and only for a visitor who's never seen it — checked via localStorage,
  // wrapped in try/catch since it can throw in private-browsing/blocked-storage contexts.
  useEffect(() => {
    if (loading || loadError) return;
    let seen = false;
    try {
      seen = localStorage.getItem(TOUR_SEEN_KEY) === "1";
    } catch {
      // Storage blocked — just skip the tour rather than crash.
    }
    if (seen) return;
    const start = setTimeout(() => setTourStep(0), CURTAIN_DURATION_MS + 300);
    return () => clearTimeout(start);
  }, [loading, loadError]);

  // Re-measures the current step's target element whenever the step changes, and on
  // resize while the tour is open — the target's actual position depends on the
  // responsive layout (see the .mp-* media query above), not just React state.
  useEffect(() => {
    if (tourStep === null) {
      setTourRect(null);
      return;
    }
    const refKey = TOUR_STEPS[tourStep].ref;
    const measure = () => {
      let el: HTMLElement | null = null;
      if (refKey === "speed") el = speedControlRef.current;
      else if (refKey === "themeLang") el = themeLangRef.current;
      else if (refKey === "disruption") el = disruptionBadgeRef.current;
      if (!el) {
        setTourRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTourRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tourStep]);

  const endTour = () => {
    setTourStep(null);
    try {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {
      // Storage blocked — the tour will just show again next visit, not worth failing over.
    }
  };

  const advanceTour = () => {
    if (tourStep === null) return;
    if (tourStep >= TOUR_STEPS.length - 1) {
      endTour();
    } else {
      setTourStep(tourStep + 1);
    }
  };

  // Re-anchors every tracked vehicle so a speed change never causes a visible jump: each
  // vehicle's current virtual position, evaluated under the *old* speed, becomes the new
  // anchor point that the *new* speed continues forward from.
  const changeSpeed = (next: number) => {
    const now = Date.now();
    for (const v of vehiclesRef.current.values()) {
      const virtualNow = v.virtualAnchorTime + (now - v.realAnchorTime) * speedRef.current;
      v.virtualAnchorTime = virtualNow;
      v.realAnchorTime = now;
    }
    speedRef.current = next;
    setSpeed(next);
  };

  // Applies + forces a redraw immediately, called directly at the point of interaction
  // (button click, or the OS-preference listener below) rather than left to a reactive
  // effect — setPaintProperty alone doesn't reliably force a repaint when nothing else is
  // already invalidating the frame, so this must run synchronously with the state change,
  // not on a subsequent render pass.
  const restyleMapNow = (nextIsDark: boolean) => {
    if (!mapRef.current) return;
    applyMapTheme(mapRef.current, nextIsDark ? themes.dark : themes.light);
    mapRef.current.triggerRepaint();
  };

  const changeThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    restyleMapNow(mode === "auto" ? systemPrefersDark : mode === "dark");
  };

  // Track system color-scheme preference for "auto" mode, live — no reload needed if the
  // viewer's OS theme changes while the tab is open.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
      if (themeMode === "auto") restyleMapNow(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeMode]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [2.3417, 48.8639], // central Paris
      zoom: 12.3,
      // Required tile attribution plus IDFM's own — both licenses (Etalab Open License for
      // static network data, IDFM's Mobility License for real-time) require credit; this is
      // the one corner every map already carries it in, no new chrome needed for it.
      attributionControl: {
        compact: true,
        customAttribution: 'Data: <a href="https://www.iledefrance-mobilites.fr" target="_blank" rel="noopener">Île-de-France Mobilités</a>',
      },
    });
    mapRef.current = map;

    // "style.load" (not "load"): the style/sprite/glyphs are ready to accept our own
    // sources and layers at this point, well before "load" would fire — "load" also waits
    // for the base map's own decorative background tiles to actually finish rendering,
    // which ties our entire app's readiness to a third-party CDN we don't control. Our own
    // transit data has no real dependency on that background having arrived yet.
    map.on("style.load", async () => {
      // Restyle toward Guimard's Ironwork with whichever theme is active right now.
      applyMapTheme(map, t);

      // Full real network geometry from IDFM's own GTFS bundle (see PRODUCT.md) — from our
      // own backend, so (unlike the base tiles) it's correct to bound this and fail loudly.
      let network: GeoJSON.FeatureCollection;
      try {
        network = await fetchNetworkWithRetry();
      } catch {
        setLoadError(true);
        return;
      }
      map.addSource("network", { type: "geojson", data: network });

      // Build the same polylines client-side, keyed by branchId (lines fork — see
      // PRODUCT.md — so a vehicle's schedule needs its specific branch's geometry, not
      // just "the" line's, to evaluate continuously every frame from its real schedule.
      for (const feature of network.features) {
        if (feature.geometry.type !== "LineString") continue;
        const props = feature.properties as { branchId?: string; id?: string; color?: string; text_color?: string; short_name?: string };
        if (!props.branchId) continue;
        lineGeometryRef.current.set(props.branchId, new Polyline(feature.geometry.coordinates as LngLat[]));
        if (props.id && props.color && props.short_name && !lineMetaRef.current.has(props.id)) {
          lineMetaRef.current.set(props.id, { color: props.color, textColor: props.text_color ?? "#000000", shortName: props.short_name });
        }
      }

      // Each line renders in its own official RATP/IDFM color, not a uniform tone — with
      // 29 lines live at once, per-line color is what makes "which line is this" readable
      // at a glance. Live lines (trains actually run on these) stay bold; any line with no
      // trains yet would be muted so it reads as context, not competing for attention.
      // line-offset: a small deterministic per-line pixel shift (stamped server-side) so
      // lines that share real physical track for a stretch — e.g. RER A and E near
      // Vincennes — render as visibly distinct parallel lines instead of one painting
      // directly over the other. Same convention official transit maps use.
      map.addLayer({
        id: "network-lines",
        type: "line",
        source: "network",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["get", "isLive"], 2.5, 1.5],
          "line-opacity": ["case", ["get", "isLive"], 0.85, 0.35],
          "line-offset": ["get", "offset"],
        },
      });
      map.addLayer({
        id: "network-stations",
        type: "circle",
        source: "network",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["case", ["get", "isLive"], 3, 2],
          "circle-color": ["get", "color"],
          "circle-opacity": ["case", ["get", "isLive"], 0.85, 0.35],
          "circle-stroke-width": 1,
          "circle-stroke-color": t.ground,
        },
      });

      // Live vehicles — fade in as real positions arrive over the WebSocket. Each is a
      // roundel in its line's color with the line number/letter labeled on it, same
      // convention as the real system's own signage.
      map.addSource("vehicles", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "vehicles-glow",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": 13,
          "circle-color": ["get", "lineColor"],
          "circle-opacity": ["match", ["get", "certainty"], "confirmed", 0.35, 0.15],
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: "vehicles-badge",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": 9,
          "circle-color": ["get", "lineColor"],
          "circle-opacity": ["match", ["get", "certainty"], "confirmed", 1, 0.6],
          // Predicted-only positions read as a fine outline rather than a solid fill —
          // position certainty is drawn, not just colored (see the direction contract).
          "circle-stroke-width": ["match", ["get", "certainty"], "confirmed", 0, 1.5],
          "circle-stroke-color": ["get", "lineColor"],
        },
      });
      map.addLayer({
        id: "vehicles-label",
        type: "symbol",
        source: "vehicles",
        layout: {
          "text-field": ["get", "lineShortName"],
          "text-size": 10,
          "text-font": ["Noto Sans Bold"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["get", "lineLabelColor"],
          "text-opacity": ["match", ["get", "certainty"], "confirmed", 1, 0.75],
        },
      });

      // "style.load" (unlike "load") doesn't imply a render pass has actually happened
      // yet — without this, the map can sit fully ready but visually blank (a flat clear
      // color) until some later interaction (zoom, pan) happens to force one.
      // triggerRepaint() alone wasn't enough (still blank in testing); resize() forces
      // MapLibre to recompute and actually render immediately, the same way a real
      // interaction does, rather than only scheduling a frame that some other internal
      // gate might still skip.
      map.resize();

      setLoading(false);
    });

    // Continuous motion loop: re-evaluate every vehicle's position from its own real
    // schedule at the current wall-clock time — not a tween between two poll snapshots,
    // so movement is live-computed the whole time, not just at poll moments.
    //
    // Throttled to ~8 updates/sec rather than every animation frame (60/sec): rebuilding
    // and re-uploading the whole vehicles GeoJSON (network-wide, potentially 1000+ trains
    // across 29 lines) at 60fps is the kind of sustained allocation/GC churn that crashes
    // the tab over time — this motion is gradual enough that 8/sec reads as smooth to a
    // human eye while cutting that work by ~7-8x.
    const RENDER_INTERVAL_MS = 125;
    let raf: number;
    let lastRender = 0;
    const animate = (tick: number) => {
      if (tick - lastRender >= RENDER_INTERVAL_MS) {
        lastRender = tick;
        const src = map.getSource("vehicles") as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(vehiclesToGeoJSON([...vehiclesRef.current.values()], lineGeometryRef.current, Date.now(), speedRef.current));
        }
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    // WebSocket — live positions + disruptions. Reconnects automatically with backoff on
    // any drop (network blip, phone backgrounding, a tunnel) — previously a dropped
    // connection just sat on "disconnected" forever until someone manually reloaded, which
    // for the actual audience here (people on phones) was the most likely failure mode.
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelayMs = 1000;
    const MAX_RECONNECT_DELAY_MS = 30_000;
    let cancelled = false;

    const connectWebSocket = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        setConnected(true);
        reconnectDelayMs = 1000; // back to the fast retry once a connection actually succeeds
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        reconnectTimer = setTimeout(connectWebSocket, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "positions") {
          const receivedAt = Date.now();
          const next = new Map<string, TrackedVehicle>();
          for (const v of msg.data as Vehicle[]) {
            next.set(v.tripId, { ...v, virtualAnchorTime: v.schedule[0]?.time ?? receivedAt, realAnchorTime: receivedAt });
          }
          vehiclesRef.current = next;
          setLastUpdate(Date.now());
        } else if (msg.type === "disruptions") {
          setDisruptions(msg.data);
        }
      };
    };
    connectWebSocket();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cancelAnimationFrame(raf);
      ws?.close();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* First-load overlay — the network alone is ~900 features plus a live WebSocket
          connection, so a blank map for a couple of seconds otherwise reads as broken.
          Reveals as a two-panel curtain once loading clears: top half exits up, bottom
          half exits down, the wordmark/spinner fading out at the seam as it parts. */}
      {overlayMounted && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: curtainOpen ? "none" : "auto" }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "50%",
              background: t.ground,
              transform: curtainOpen ? "translateY(-100%)" : "translateY(0)",
              transition: `transform ${CURTAIN_DURATION_MS}ms cubic-bezier(0.76, 0, 0.24, 1)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "50%",
              background: t.ground,
              transform: curtainOpen ? "translateY(100%)" : "translateY(0)",
              transition: `transform ${CURTAIN_DURATION_MS}ms cubic-bezier(0.76, 0, 0.24, 1)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              opacity: curtainOpen ? 0 : 1,
              transition: "opacity 0.35s ease",
            }}
          >
            <div
              style={{
                color: t.ink,
                fontFamily: "Georgia, serif",
                letterSpacing: "0.1em",
                fontSize: 20,
                textTransform: "uppercase",
              }}
            >
              Métropolitain
            </div>
            {loadError ? (
              <>
                <div style={{ marginTop: 14, color: t.disruption, fontSize: 11, letterSpacing: "0.1em", textAlign: "center", maxWidth: 280 }}>
                  {lang === "en"
                    ? "COULD NOT REACH THE NETWORK — CHECK YOUR CONNECTION"
                    : "IMPOSSIBLE DE JOINDRE LE RÉSEAU — VÉRIFIEZ VOTRE CONNEXION"}
                </div>
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    marginTop: 16,
                    padding: "8px 20px",
                    background: "transparent",
                    border: `1px solid ${t.bronze}`,
                    color: t.ink,
                    fontSize: 11,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {lang === "en" ? "Retry" : "Réessayer"}
                </button>
              </>
            ) : (
              <>
                <div
                  style={{
                    marginTop: 14,
                    width: 28,
                    height: 28,
                    border: `2px solid ${t.bronze}`,
                    borderTopColor: t.amberLamp,
                    borderRadius: "50%",
                    animation: "metropolitain-spin 0.9s linear infinite",
                  }}
                />
                <div style={{ marginTop: 14, color: t.ink, opacity: 0.6, fontSize: 11, letterSpacing: "0.15em" }}>
                  {lang === "en" ? "LOADING THE NETWORK…" : "CHARGEMENT DU RÉSEAU…"}
                </div>
              </>
            )}
          </div>
          <style>{`@keyframes metropolitain-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Desktop keeps all three top clusters in one row (wordmark left, speed control
          centered, theme+language right) — plenty of room above ~640px. Below that they
          reflow: language stays top-right (now its own row with the wordmark, since the
          two are narrow enough to share), while speed and theme mode each get their own
          centered row — their combined widths don't fit any narrower, which is what
          caused the original mobile overlap. */}
      {/* .mp-theme and .mp-lang are siblings, each independently anchored to the root —
          not one nested inside the other. An absolutely-positioned element's top/right
          resolve against its *nearest positioned ancestor*, so nesting one inside another
          absolutely-positioned box (the original bug here) measures its offset from that
          box's corner instead of the viewport's, silently landing it in the wrong place
          the moment the outer box's own size or position changes — exactly what happened
          on narrow screens. Keeping every top-level cluster a flat sibling means each one's
          top/right always means "from the screen edge," full stop, at every width. */}
      {/* z-index: 5 on every chrome element below — MapLibre's own attribution control
          ships with z-index: 2 in its default CSS, so any of our UI that overlaps it
          without an explicit z-index (the previous "auto") loses regardless of DOM order,
          since z-index beats paint order once either side sets one. Confirmed the hard
          way, with elementFromPoint at the disruption badge's own coordinates returning
          the attribution control's DOM node, not the badge, despite the badge existing,
          visible, opacity 1, at that exact point. */}
      <style>{`
        .mp-wordmark { position: absolute; top: 16px; left: 16px; z-index: 5; }
        .mp-speed { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 5; }
        .mp-theme { position: absolute; top: 16px; right: 93px; z-index: 5; }
        .mp-lang { position: absolute; top: 16px; right: 16px; z-index: 5; }
        @media (max-width: 640px) {
          .mp-wordmark { top: 12px; left: 12px; }
          .mp-lang { top: 12px; right: 12px; }
          .mp-speed { top: 58px; left: 50%; right: auto; transform: translateX(-50%); }
          .mp-theme { top: 102px; left: 50%; right: auto; transform: translateX(-50%); }
        }
      `}</style>

      <div
        className="mp-wordmark"
        style={{
          color: t.ink,
          fontFamily: "Georgia, serif",
          letterSpacing: "0.08em",
          fontSize: 15,
          textTransform: "uppercase",
          pointerEvents: "none",
          textShadow: isDark ? "0 1px 3px rgba(0,0,0,0.6)" : "0 1px 2px rgba(255,255,255,0.5)",
        }}
      >
        Métropolitain
        <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: "0.15em", marginTop: 2 }}>
          {connected ? (lang === "en" ? "live" : "en direct") : lang === "en" ? "connecting…" : "connexion…"}
        </div>
      </div>

      {/* Speed control: defaults to 1x (strictly real); any faster pace is the viewer's own
          explicit choice, always visible in the active button rather than assumed silently. */}
      <div
        ref={speedControlRef}
        className="mp-speed"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: panelBg,
          border: `1px solid ${t.bronze}`,
          borderRadius: 3,
          padding: "4px 8px",
        }}
      >
        <span style={{ color: t.ink, fontSize: 10, letterSpacing: "0.1em", opacity: 0.7, marginRight: 2 }}>
          {lang === "en" ? "SPEED" : "VITESSE"}
        </span>
        {SPEED_OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => changeSpeed(opt)}
            style={{
              background: speed === opt ? t.amberLamp : "transparent",
              color: speed === opt ? t.ground : t.ink,
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

      {/* Light/Dark/Auto — Dark is the tested, primary Guimard's Ironwork identity;
          Light translates the same verdigris/bronze materials to a daytime register
          rather than a generic invert. Auto follows the OS preference live.
          A sibling of .mp-lang, not a parent — see the note above the <style> block on
          why nesting one absolutely-positioned cluster inside another breaks its offsets. */}
      <div
        ref={themeLangRef}
        className="mp-theme"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: panelBg,
          border: `1px solid ${t.bronze}`,
          borderRadius: 3,
          padding: "4px 6px",
        }}
      >
        {(
          [
            ["dark", lang === "en" ? "DARK" : "SOMBRE"],
            ["light", lang === "en" ? "LIGHT" : "CLAIR"],
            ["auto", "AUTO"],
          ] as [ThemeMode, string][]
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => changeThemeMode(mode)}
            style={{
              background: themeMode === mode ? t.amberLamp : "transparent",
              color: themeMode === mode ? t.ground : t.ink,
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

      <div className="mp-lang" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* Replay the first-load tour on demand — most useful right after switching
            language, so a French-speaking then English-speaking (or vice versa) visitor
            can see it in the language they actually want, not just once at first load. */}
        <button
          onClick={() => setTourStep(0)}
          title={lang === "en" ? "Replay tour" : "Revoir la visite"}
          aria-label={lang === "en" ? "Replay tour" : "Revoir la visite"}
          style={{
            background: panelBg,
            color: t.ink,
            border: `1px solid ${t.bronze}`,
            borderRadius: "50%",
            width: 24,
            height: 24,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ?
        </button>
        <button
          onClick={() => setLang((l) => (l === "en" ? "fr" : "en"))}
          style={{
            background: panelBg,
            color: t.ink,
            border: `1px solid ${t.bronze}`,
            borderRadius: 3,
            padding: "4px 10px",
            fontSize: 11,
            letterSpacing: "0.1em",
            cursor: "pointer",
          }}
        >
          {lang.toUpperCase()}
        </button>
      </div>

      {/* Compact, always-visible disruption indicator — quiet when clear, a line count
          (not a raw notice count) when not. Never grows to cover the map; full detail
          lives in the panel it opens. Click toggles open/closed, same as the map's other
          buttons — it used to only ever open. */}
      <button
        ref={disruptionBadgeRef}
        onClick={() => setDisruptionsOpen((o) => !o)}
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: panelBg,
          color: t.ink,
          border: `1px solid ${activeLineIds.size > 0 ? severityColor(worstActiveSeverity ?? "info") : t.bronze}`,
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

      {/* Slide-in panel: map stays visible and interactive behind it, unlike a full modal. */}
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
          borderLeft: `1px solid ${t.bronze}`,
          color: t.ink,
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          padding: 16,
          overflowY: "auto",
          transform: disruptionsOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ letterSpacing: "0.1em", fontSize: 11, opacity: 0.7 }}>
            {lang === "en" ? "DISRUPTIONS" : "PERTURBATIONS"}
          </span>
          {/* Explicit 32x32 hit area around the small × glyph — the old version was just
              the bare character with no padding, well under any real touch-target size. */}
          <button
            onClick={() => setDisruptionsOpen(false)}
            style={{
              background: "none",
              border: "none",
              color: t.ink,
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
            const meta = lineMetaRef.current.get(lineId);
            return (
              <div key={lineId} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: meta?.color ?? t.bronze,
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
                      onClick={() => setExpandedDisruptionId(expanded ? null : d.id)}
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
          <div style={{ marginTop: 16, borderTop: `1px solid ${t.bronze}`, paddingTop: 12 }}>
            <div
              onClick={() => setUpcomingOpen((o) => !o)}
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
              <span>{lang === "en" ? `UPCOMING (${upcomingDisruptions.length})` : `À VENIR (${upcomingDisruptions.length})`}</span>
              <span>{upcomingOpen ? "▾" : "▸"}</span>
            </div>
            {upcomingOpen && (
              <div style={{ marginTop: 8 }}>
                {upcomingByLine.map(([lineId, items]) => {
                  const meta = lineMetaRef.current.get(lineId);
                  return (
                    <div key={lineId} style={{ marginBottom: 10, opacity: 0.7 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: meta?.color ?? t.bronze,
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
                            onClick={() => setExpandedDisruptionId(expanded ? null : d.id)}
                            style={{ padding: "3px 8px", marginBottom: 3, marginLeft: 24, cursor: "pointer", fontSize: 11 }}
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

      {/* First-load tour: a spotlight ring around the current step's real element (via
          box-shadow filling the whole viewport except a cutout at its measured rect — no
          clip-path/mask needed) plus a caption card. The intro step has no single target,
          so it just dims the screen and centers the card instead. */}
      {tourStep !== null &&
        (() => {
          const step = TOUR_STEPS[tourStep];
          const vh = typeof window !== "undefined" ? window.innerHeight : 800;
          // Reserve room for the card itself when deciding — and clamping — where it
          // goes, not just the target's own position, so it can never be pushed off a
          // short viewport (the bug hit above: a naive "top: 50%" for the intro card
          // overflowed off small screens instead of ever actually being re-clamped).
          const CARD_H_ESTIMATE = 190;
          const placeBelow = !tourRect || tourRect.top + tourRect.height / 2 < vh / 2;
          const rawTop = tourRect ? (placeBelow ? tourRect.top + tourRect.height + 16 : tourRect.top - 16 - CARD_H_ESTIMATE) : null;
          const clampedTop = rawTop === null ? null : Math.min(Math.max(rawTop, 16), Math.max(16, vh - CARD_H_ESTIMATE - 16));

          const card = (
            <div
              style={{
                width: "min(320px, calc(100vw - 32px))",
                maxHeight: "calc(100vh - 32px)",
                overflowY: "auto",
                background: panelBgSolid,
                border: `1px solid ${t.bronze}`,
                borderRadius: 4,
                padding: 16,
                boxSizing: "border-box",
                color: t.ink,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: "0.1em", marginBottom: 6 }}>
                {tourStep + 1} / {TOUR_STEPS.length}
              </div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 15, marginBottom: 6 }}>
                {lang === "en" ? step.titleEn : step.titleFr}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5, marginBottom: 14 }}>
                {lang === "en" ? step.bodyEn : step.bodyFr}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button
                  onClick={endTour}
                  style={{ background: "none", border: "none", color: t.ink, opacity: 0.6, fontSize: 11, cursor: "pointer" }}
                >
                  {lang === "en" ? "Skip" : "Passer"}
                </button>
                <button
                  onClick={advanceTour}
                  style={{
                    background: t.amberLamp,
                    color: t.ground,
                    border: "none",
                    borderRadius: 2,
                    padding: "6px 14px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {tourStep >= TOUR_STEPS.length - 1 ? (lang === "en" ? "Got it" : "Compris") : lang === "en" ? "Next" : "Suivant"}
                </button>
              </div>
            </div>
          );

          return (
            <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
              {!tourRect && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)" }} />}
              {tourRect && (
                <div
                  style={{
                    position: "fixed",
                    top: tourRect.top - 6,
                    left: tourRect.left - 6,
                    width: tourRect.width + 12,
                    height: tourRect.height + 12,
                    borderRadius: 6,
                    border: `2px solid ${t.amberLamp}`,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
                    pointerEvents: "none",
                  }}
                />
              )}
              {tourRect ? (
                // Grounded in a real measured rect, not a viewport percentage — clamped
                // above so it always stays fully on-screen regardless of viewport size.
                <div style={{ position: "fixed", top: clampedTop as number, left: "50%", transform: "translateX(-50%)" }}>{card}</div>
              ) : (
                // No single target (the intro step) — flexbox-center it instead of the
                // "top: 50%; transform: translate(-50%,-50%)" percentage trick, which is
                // exactly what overflowed off short viewports: a flex parent centers its
                // child using the box's actual rendered size, so it can never place the
                // card partly outside the viewport the way a percentage-of-height
                // calculation can when the content is taller than expected.
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 16,
                    boxSizing: "border-box",
                  }}
                >
                  {card}
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
};

export default MetroMap;
