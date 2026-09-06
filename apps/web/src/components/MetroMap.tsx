"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { themes, type ThemePalette } from "@/lib/theme";
import { Polyline, offsetPoint, type LngLat } from "@/lib/polyline";
import { config } from "@/config";
import type {
  TrackedVehicle,
  Vehicle,
  Disruption,
  DisruptionSeverity,
  ThemeMode,
  TourStepDef,
  LineMeta,
} from "@/types";
import CurtainOverlay from "@/components/CurtainOverlay";
import SpeedControl from "@/components/SpeedControl";
import ThemeControl from "@/components/ThemeControl";
import DisruptionPanel from "@/components/DisruptionPanel";
import LinePanel from "@/components/LinePanel";
import TourOverlay from "@/components/TourOverlay";

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
    const timeout = setTimeout(() => controller.abort(), config.networkFetchTimeoutMs);
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

const isDisruptionActiveNow = (d: Disruption, now: number): boolean => {
  return d.periods.length === 0 || d.periods.some((p) => now >= p.begin && now <= p.end);
};

const SEVERITY_RANK: Record<DisruptionSeverity, number> = { blocking: 2, reduced: 1, info: 0 };

const SPEED_OPTIONS = [1, 2, 4, 8] as const;
const DEFAULT_SPEED = 1;

const DEFAULT_THEME_MODE: ThemeMode = "dark";
const CURTAIN_DURATION_MS = 900;
const TOUR_SEEN_KEY = "metropolitain_tour_seen";

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
    bodyFr: "Passez du mode sombre au mode clair, basculez entre français et anglais, ou revoyez cette visite, à tout moment.",
    bodyEn: "Switch between dark and light mode, between French and English, or replay this tour, anytime.",
  },
  {
    ref: "disruption",
    titleFr: "Perturbations en direct",
    titleEn: "Live disruptions",
    bodyFr: "Cet indicateur affiche les perturbations de trafic en cours, ligne par ligne.",
    bodyEn: "This shows current service disruptions, line by line.",
  },
  {
    ref: "lines",
    titleFr: "Isoler une ou plusieurs lignes",
    titleEn: "Isolate one or more lines",
    bodyFr: "Choisissez une ou plusieurs lignes pour les faire ressortir et estomper le reste du réseau.",
    bodyEn: "Pick one or more lines to make them stand out and dim the rest of the network.",
  },
];

const fractionAt = (schedule: { fraction: number; time: number }[], virtualNow: number): number => {
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

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const REFERENCE_LAT_RAD = (48.8566 * Math.PI) / 180;

const metersPerPixel = (zoom: number): number => {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(REFERENCE_LAT_RAD)) / (256 * 2 ** zoom);
};

const vehiclesToGeoJSON = (
  vehicles: TrackedVehicle[],
  lineGeometry: Map<string, Polyline>,
  lineOffsets: Map<string, number>,
  now: number,
  speed: number,
  zoom: number
): GeoJSON.FeatureCollection => {
  const metersPerOffsetUnit = metersPerPixel(zoom);
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const polyline = lineGeometry.get(v.branchId);
    if (!polyline) continue;

    const virtualNow = v.virtualAnchorTime + (now - v.realAnchorTime) * speed;
    const fraction = fractionAt(v.schedule, virtualNow);
    const { position: rawPosition, bearing } = polyline.pointAtFraction(fraction);
    const offsetUnits = lineOffsets.get(v.lineId) ?? 0;
    const position = offsetPoint(rawPosition, bearing + 90, offsetUnits * metersPerOffsetUnit);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: position },
      properties: {
        tripId: v.tripId,
        lineId: v.lineId,
        lineShortName: v.lineShortName,
        lineColor: v.lineColor,
        lineLabelColor: v.lineLabelColor,
        bearing,
        certainty: v.certainty,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
};

const OWN_LAYER_IDS = new Set(["network-lines", "network-stations", "vehicles-glow", "vehicles-badge", "vehicles-label"]);

const applyMapTheme = (map: MapLibreMap, t: ThemePalette) => {
  if (!map.isStyleLoaded()) return;
  const style = map.getStyle();
  if (!style || !style.layers) return;
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
  try {
    if (map.getLayer("network-stations")) {
      map.setPaintProperty("network-stations", "circle-stroke-color", t.ground);
    }
  } catch {
    // Layer not yet added
  }
};

const MetroMap = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehiclesRef = useRef<Map<string, TrackedVehicle>>(new Map());
  const lineGeometryRef = useRef<Map<string, Polyline>>(new Map());
  const lineMetaRef = useRef<Map<string, LineMeta>>(new Map());
  const lineOffsetsRef = useRef<Map<string, number>>(new Map());
  const speedRef = useRef<number>(DEFAULT_SPEED);

  const [disruptions, setDisruptions] = useState<Disruption[]>([]);
  const [lang, setLang] = useState<"en" | "fr">("fr");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [curtainOpen, setCurtainOpen] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [disruptionsOpen, setDisruptionsOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [linesPanelOpen, setLinesPanelOpen] = useState(false);
  const [expandedDisruptionId, setExpandedDisruptionId] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);

  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourRect, setTourRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const speedControlRef = useRef<HTMLDivElement>(null);
  const themeLangRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const disruptionBadgeRef = useRef<HTMLButtonElement>(null);
  const linesBadgeRef = useRef<HTMLButtonElement>(null);

  const isDark = themeMode === "auto" ? systemPrefersDark : themeMode === "dark";
  const t = isDark ? themes.dark : themes.light;
  const panelBg = isDark ? "rgba(28,26,22,0.75)" : "rgba(232,226,212,0.85)";
  const panelBgSolid = isDark ? "rgba(20,19,16,0.97)" : "rgba(232,226,212,0.97)";

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

  const MODE_ORDER = ["metro", "rer", "transilien", "tram"] as const;
  const MODE_LABEL: Record<string, { fr: string; en: string }> = {
    metro: { fr: "MÉTRO", en: "METRO" },
    rer: { fr: "RER", en: "RER" },
    transilien: { fr: "TRANSILIEN", en: "TRANSILIEN" },
    tram: { fr: "TRAMWAY", en: "TRAM" },
  };

  const lineCollator = new Intl.Collator("en", { numeric: true });
  const linesByMode = MODE_ORDER.map((mode) => ({
    mode,
    lines: [...lineMetaRef.current.entries()]
      .filter(([, meta]) => meta.mode === mode)
      .sort((a, b) => lineCollator.compare(a[1].shortName, b[1].shortName)),
  })).filter((group) => group.lines.length > 0);

  const toggleLineSelection = (lineId: string) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const clearLineSelection = () => setSelectedLines(new Set());

  useEffect(() => {
    if (loading) return;
    const raf = requestAnimationFrame(() => setCurtainOpen(true));
    const unmount = setTimeout(() => setOverlayMounted(false), CURTAIN_DURATION_MS + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(unmount);
    };
  }, [loading]);

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

  useEffect(() => {
    if (tourStep === null) {
      setTourRect(null);
      return;
    }
    const refKey = TOUR_STEPS[tourStep].ref;
    const measure = () => {
      if (refKey === "themeLang") {
        const r1 = themeLangRef.current?.getBoundingClientRect();
        const r2 = langRef.current?.getBoundingClientRect();
        if (!r1 && !r2) {
          setTourRect(null);
          return;
        }
        const rects = [r1, r2].filter((r): r is DOMRect => !!r);
        const top = Math.min(...rects.map((r) => r.top));
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        setTourRect({ top, left, width: right - left, height: bottom - top });
        return;
      }

      let el: HTMLElement | null = null;
      if (refKey === "speed") el = speedControlRef.current;
      else if (refKey === "disruption") el = disruptionBadgeRef.current;
      else if (refKey === "lines") el = linesBadgeRef.current;
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
      // Storage blocked — the tour will just show again next visit.
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

  const restyleMapNow = (nextIsDark: boolean) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyMapTheme(map, nextIsDark ? themes.dark : themes.light);
    map.triggerRepaint();
  };

  const changeThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    restyleMapNow(mode === "auto" ? systemPrefersDark : mode === "dark");
  };

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
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      if (!map.getLayer("network-lines")) return;
    } catch {
      return;
    }

    if (selectedLines.size === 0) {
      map.setPaintProperty("network-lines", "line-opacity", ["case", ["get", "isLive"], 0.85, 0.35]);
      map.setPaintProperty("network-stations", "circle-opacity", ["case", ["get", "isLive"], 0.85, 0.35]);
      map.setPaintProperty("vehicles-glow", "circle-opacity", ["match", ["get", "certainty"], "confirmed", 0.35, 0.15]);
      map.setPaintProperty("vehicles-badge", "circle-opacity", ["match", ["get", "certainty"], "confirmed", 1, 0.6]);
      map.setPaintProperty("vehicles-label", "text-opacity", ["match", ["get", "certainty"], "confirmed", 1, 0.75]);
      return;
    }

    const selected = ["literal", [...selectedLines]] as const;
    map.setPaintProperty("network-lines", "line-opacity", ["case", ["in", ["get", "id"], selected], 0.9, 0.06]);
    map.setPaintProperty("network-stations", "circle-opacity", ["case", ["in", ["get", "id"], selected], 0.9, 0.06]);
    map.setPaintProperty("vehicles-glow", "circle-opacity", [
      "case",
      ["in", ["get", "lineId"], selected],
      ["match", ["get", "certainty"], "confirmed", 0.35, 0.15],
      0.03,
    ]);
    map.setPaintProperty("vehicles-badge", "circle-opacity", [
      "case",
      ["in", ["get", "lineId"], selected],
      ["match", ["get", "certainty"], "confirmed", 1, 0.6],
      0.06,
    ]);
    map.setPaintProperty("vehicles-label", "text-opacity", [
      "case",
      ["in", ["get", "lineId"], selected],
      ["match", ["get", "certainty"], "confirmed", 1, 0.75],
      0.06,
    ]);
  }, [selectedLines]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: config.mapStyleUrl,
      center: [2.3417, 48.8639],
      zoom: 12.3,
      attributionControl: {
        compact: true,
        customAttribution: 'Data: <a href="https://www.iledefrance-mobilites.fr" target="_blank" rel="noopener">Île-de-France Mobilités</a>',
      },
    });
    mapRef.current = map;

    map.on("style.load", async () => {
      applyMapTheme(map, t);

      let network: GeoJSON.FeatureCollection;
      try {
        network = await fetchNetworkWithRetry();
      } catch {
        setLoadError(true);
        return;
      }
      map.addSource("network", { type: "geojson", data: network });

      for (const feature of network.features) {
        if (feature.geometry.type !== "LineString") continue;
        const props = feature.properties as {
          branchId?: string;
          id?: string;
          color?: string;
          text_color?: string;
          short_name?: string;
          offset?: number;
          mode?: string;
        };
        if (!props.branchId) continue;
        lineGeometryRef.current.set(props.branchId, new Polyline(feature.geometry.coordinates as LngLat[]));
        if (props.id && props.color && props.short_name && !lineMetaRef.current.has(props.id)) {
          lineMetaRef.current.set(props.id, {
            color: props.color,
            textColor: props.text_color ?? "#000000",
            shortName: props.short_name,
            mode: props.mode ?? "metro",
          });
          lineOffsetsRef.current.set(props.id, props.offset ?? 0);
        }
      }

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

      map.resize();
      setLoading(false);
    });

    const RENDER_INTERVAL_MS = 125;
    let raf: number;
    let lastRender = 0;
    const animate = (tick: number) => {
      if (tick - lastRender >= RENDER_INTERVAL_MS) {
        lastRender = tick;
        const src = map.getSource("vehicles") as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(
            vehiclesToGeoJSON(
              [...vehiclesRef.current.values()],
              lineGeometryRef.current,
              lineOffsetsRef.current,
              Date.now(),
              speedRef.current,
              map.getZoom()
            )
          );
        }
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelayMs = config.wsReconnectInitialDelayMs;
    let cancelled = false;

    const connectWebSocket = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        setConnected(true);
        reconnectDelayMs = config.wsReconnectInitialDelayMs;
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        reconnectTimer = setTimeout(connectWebSocket, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, config.wsReconnectMaxDelayMs);
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
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      <CurtainOverlay
        mounted={overlayMounted}
        open={curtainOpen}
        durationMs={CURTAIN_DURATION_MS}
        palette={t}
        loadError={loadError}
        lang={lang}
      />

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

      <SpeedControl
        ref={speedControlRef}
        speed={speed}
        speedOptions={SPEED_OPTIONS}
        panelBg={panelBg}
        palette={t}
        lang={lang}
        onSpeedChange={changeSpeed}
      />

      <ThemeControl
        ref={themeLangRef}
        themeMode={themeMode}
        panelBg={panelBg}
        palette={t}
        lang={lang}
        onThemeModeChange={changeThemeMode}
      />

      <div ref={langRef} className="mp-lang" style={{ display: "flex", alignItems: "center", gap: 6 }}>
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

      <DisruptionPanel
        badgeRef={disruptionBadgeRef}
        open={disruptionsOpen}
        onToggleOpen={() => setDisruptionsOpen((o) => !o)}
        onClose={() => setDisruptionsOpen(false)}
        activeLineIds={activeLineIds}
        worstActiveSeverity={worstActiveSeverity}
        activeByLine={activeByLine}
        upcomingByLine={upcomingByLine}
        upcomingDisruptionsCount={upcomingDisruptions.length}
        upcomingOpen={upcomingOpen}
        onToggleUpcoming={() => setUpcomingOpen((o) => !o)}
        expandedDisruptionId={expandedDisruptionId}
        onToggleExpanded={(id) => setExpandedDisruptionId(expandedDisruptionId === id ? null : id)}
        lastUpdate={lastUpdate}
        lang={lang}
        palette={t}
        panelBg={panelBg}
        panelBgSolid={panelBgSolid}
        lineMeta={lineMetaRef.current}
      />

      <LinePanel
        badgeRef={linesBadgeRef}
        open={linesPanelOpen}
        onToggleOpen={() => setLinesPanelOpen((o) => !o)}
        onClose={() => setLinesPanelOpen(false)}
        selectedLines={selectedLines}
        onToggleLine={toggleLineSelection}
        onClearSelection={clearLineSelection}
        linesByMode={linesByMode}
        modeLabels={MODE_LABEL}
        lang={lang}
        palette={t}
        panelBg={panelBg}
        panelBgSolid={panelBgSolid}
      />

      <TourOverlay
        tourStep={tourStep}
        tourRect={tourRect}
        steps={TOUR_STEPS}
        lang={lang}
        palette={t}
        panelBgSolid={panelBgSolid}
        onAdvance={advanceTour}
        onEnd={endTour}
      />
    </div>
  );
};

export default MetroMap;
