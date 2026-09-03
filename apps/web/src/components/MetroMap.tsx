"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { themes, type ThemePalette } from "@/lib/theme";
import { Polyline, type LngLat } from "@/lib/polyline";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001/ws";

/**
 * Our own backend, unlike the third-party base-map tiles, is infrastructure we control end
 * to end — there's no real product without this data, so unlike the tiles it's fine (and
 * correct) to bound it: an 8s timeout, one retry, then surface a real error instead of
 * spinning forever.
 */
async function fetchNetworkWithRetry(): Promise<GeoJSON.FeatureCollection> {
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
}

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

interface Disruption {
  id: string;
  lineId: string;
  textFr: string;
  textEn: string;
}

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

/**
 * Where a vehicle actually is *right now*, continuously — not just at the last poll.
 * Finds whichever two schedule points bracket the accelerated virtual time and interpolates
 * between them. Once virtual time runs past the last known real point (which happens often,
 * since acceleration burns through a ~90s poll's worth of real schedule in ~11s), it keeps
 * moving by extrapolating forward at the rate implied by the last known segment, rather than
 * freezing — clamped so it never runs off the end of the actual track.
 */
function fractionAt(schedule: SchedulePoint[], virtualNow: number): number {
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
}

function vehiclesToGeoJSON(vehicles: TrackedVehicle[], lineGeometry: Map<string, Polyline>, now: number, speed: number): GeoJSON.FeatureCollection {
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
}

// Our own layers (added after this runs the first time) must never be touched by the
// base-map restyle below — network-lines is type "line" and vehicles-label is type
// "symbol", so a naive type-only match re-applying on a theme switch would stomp their
// data-driven per-line color expressions with flat base-map colors.
const OWN_LAYER_IDS = new Set(["network-lines", "network-stations", "vehicles-glow", "vehicles-badge", "vehicles-label"]);

/** Applies the resolved palette to the base map's own layers (background/land/water/roads/
 *  labels) — called once at load and again whenever the theme changes, so switching
 *  light/dark/auto re-styles the already-loaded map instead of needing a reload. */
function applyMapTheme(map: MapLibreMap, t: ThemePalette) {
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
}

export default function MetroMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehiclesRef = useRef<Map<string, TrackedVehicle>>(new Map());
  const lineGeometryRef = useRef<Map<string, Polyline>>(new Map());
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);

  const isDark = themeMode === "auto" ? systemPrefersDark : themeMode === "dark";
  const t = isDark ? themes.dark : themes.light;
  const panelBg = isDark ? "rgba(28,26,22,0.75)" : "rgba(232,226,212,0.85)";
  const panelBgSolid = isDark ? "rgba(20,19,16,0.97)" : "rgba(232,226,212,0.97)";

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

  // Re-anchors every tracked vehicle so a speed change never causes a visible jump: each
  // vehicle's current virtual position, evaluated under the *old* speed, becomes the new
  // anchor point that the *new* speed continues forward from.
  function changeSpeed(next: number) {
    const now = Date.now();
    for (const v of vehiclesRef.current.values()) {
      const virtualNow = v.virtualAnchorTime + (now - v.realAnchorTime) * speedRef.current;
      v.virtualAnchorTime = virtualNow;
      v.realAnchorTime = now;
    }
    speedRef.current = next;
    setSpeed(next);
  }

  // Applies + forces a redraw immediately, called directly at the point of interaction
  // (button click, or the OS-preference listener below) rather than left to a reactive
  // effect — setPaintProperty alone doesn't reliably force a repaint when nothing else is
  // already invalidating the frame, so this must run synchronously with the state change,
  // not on a subsequent render pass.
  function restyleMapNow(nextIsDark: boolean) {
    if (!mapRef.current) return;
    applyMapTheme(mapRef.current, nextIsDark ? themes.dark : themes.light);
    mapRef.current.triggerRepaint();
  }

  function changeThemeMode(mode: ThemeMode) {
    setThemeMode(mode);
    restyleMapNow(mode === "auto" ? systemPrefersDark : mode === "dark");
  }

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
        const branchId = (feature.properties as { branchId?: string })?.branchId;
        if (!branchId) continue;
        lineGeometryRef.current.set(branchId, new Polyline(feature.geometry.coordinates as LngLat[]));
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

    // WebSocket — live positions + disruptions.
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
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

    return () => {
      cancelAnimationFrame(raf);
      ws.close();
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

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
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
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
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

      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", alignItems: "center", gap: 8 }}>
        {/* Light/Dark/Auto — Dark is the tested, primary Guimard's Ironwork identity;
            Light translates the same verdigris/bronze materials to a daytime register
            rather than a generic invert. Auto follows the OS preference live. */}
        <div
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

      {/* Compact, always-visible disruption indicator — quiet when clear, a count when not.
          Never grows to cover the map; full detail lives in the panel it opens. */}
      <button
        onClick={() => setDisruptionsOpen(true)}
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: panelBg,
          color: t.ink,
          border: `1px solid ${disruptions.length > 0 ? t.disruption : t.bronze}`,
          borderRadius: 3,
          padding: "6px 10px",
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
          cursor: "pointer",
        }}
      >
        {disruptions.length > 0 && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: t.disruption,
              display: "inline-block",
            }}
          />
        )}
        {disruptions.length === 0
          ? lang === "en"
            ? "All clear"
            : "Trafic normal"
          : lang === "en"
            ? `${disruptions.length} disruption${disruptions.length > 1 ? "s" : ""}`
            : `${disruptions.length} perturbation${disruptions.length > 1 ? "s" : ""}`}
      </button>

      {/* Slide-in panel: map stays visible and interactive behind it, unlike a full modal. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
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
          <button
            onClick={() => setDisruptionsOpen(false)}
            style={{ background: "none", border: "none", color: t.ink, fontSize: 16, cursor: "pointer", lineHeight: 1 }}
            aria-label={lang === "en" ? "Close" : "Fermer"}
          >
            ×
          </button>
        </div>
        {disruptions.length === 0 ? (
          <div style={{ opacity: 0.5 }}>{lang === "en" ? "All clear" : "Trafic normal"}</div>
        ) : (
          disruptions.map((d) => (
            <div
              key={d.id}
              style={{
                background: isDark ? "rgba(194,59,45,0.15)" : "rgba(168,50,38,0.12)",
                borderLeft: `2px solid ${t.disruption}`,
                padding: "6px 10px",
                marginBottom: 8,
              }}
            >
              {lang === "en" ? d.textEn : d.textFr}
            </div>
          ))
        )}
        {lastUpdate && (
          <div style={{ opacity: 0.4, fontSize: 10, marginTop: 8 }}>
            {lang === "en" ? "Updated" : "Mis à jour"} {new Date(lastUpdate).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
