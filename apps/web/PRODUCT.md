# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Frontend: Next.js + TypeScript, MapLibre GL JS for the map (vector tiles from a free provider, e.g. OpenFreeMap/MapTiler free tier — not raw `tile.openstreetmap.org` raster tiles, which can't be restyled to the dark ironwork world and aren't meant for production traffic). Deployed as a static/standard Next.js build to Vercel or Netlify, not containerized.

Backend (separate workspace, `apps/server`): Node.js + TypeScript (Express), ingests Île-de-France Mobilités (IDFM) PRIM feeds, maintains in-memory vehicle/disruption state, broadcasts over WebSocket. Dockerized and deployed on the user's own Hetzner server via `docker-compose` (app container + reverse proxy with TLS — nginx+certbot or Caddy, not yet decided) — not Vercel/Netlify, since persistent WebSocket connections don't fit their serverless model.

No database; state is entirely in-memory and rebuilt from the feed on restart.

## Users

Casual glancers: general public and transit enthusiasts, no login. They open the site to watch the city's rail network move in real time, with no task to complete. Success is that it is instantly readable and mesmerizing at a glance, not that it helps them accomplish something.

## Product Purpose

Visualize live train/metro movement and service disruptions across Paris (RATP + SNCF Transilien/RER via IDFM), with other cities added later. It exists as a fun, ambient, informative artifact — a live portrait of a transit network, not a utility.

## Positioning

Pure observation, not a trip planner, and never becomes one — no "get me from A to B", no personal itineraries, no routing. That is the deliberate difference from Citymapper, the RATP app, or Transit: those help someone get somewhere; this shows what the network is doing right now, including its small disruptions and delays, as something to watch rather than query.

## Operating Context

Public website with no accounts or login for visitors. Frontend on Vercel/Netlify, backend on the user's Hetzner infrastructure. Primary data source is IDFM's PRIM open data platform (account created, logged in; API key generation still pending). Confirmed there is no viable alternative: Google Maps Platform has no product that exposes live network-wide vehicle positions to third parties (Routes API only computes single point-to-point itineraries from Google's internal data) — IDFM, as the transit authority itself, is the only source for this.

IDFM's real-time offering is not branded "GTFS-RT" in their catalog; the relevant APIs are:
- **Next Departures – Global Query**: real-time predicted times for the whole network in one exchange, entry point `GET /estimated-timetable`, format **SIRI Lite** (not GTFS-RT protobuf — no `gtfs-realtime-bindings`-style binary parsing needed, this is a structured XML/JSON exchange). Source data refreshes once/minute; polling faster gains nothing. Quota: 1,000/day default, 1,500/day on a free increased-quota request.
- **Traffic Info Messages – Global Query**: all current/upcoming disruptions with affected lines and stops. Quota: 1,000/day default, 18,000/day increased.
- **Scheduled schedules (GTFS Datahub)**: the static GTFS bundle (routes/stops/shapes/timetables), refreshed by IDFM 3×/day.

A second external dependency is now needed for translation (French disruption text → English): DeepL's API is the recommended pick — best FR/EN quality of the free-tier options, and its free tier (500,000 characters/month) is far more than our distinct-message volume needs given the cache-on-first-sight design below. This needs its own free account and API key, separate from PRIM — the user's to create, not something that can be done on their behalf.

**Data license & attribution (confirmed from IDFM's licensing page, prim.iledefrance-mobilites.fr/en/licences):**
- Static reference data (stops, lines, routes, shapes) is under Etalab's French "Open License" — free, commercial reuse allowed, **attribution mandatory**.
- Real-time data (Next Departures, Traffic Info Messages) is under IDFM's own "Mobility License", built on ODbL principles — attribution expected as a core ODbL condition.
- Plan/map graphics are CC BY-NC-ND 3.0 France (not used here — we build our own geometry from the GTFS shapes, not their map images).
- Implementation: extend MapLibre's existing attribution control (the small required corner text already showing tile-provider credit) to also read "Data: Île-de-France Mobilités" linking to their site — satisfies both licenses without adding any new visual chrome, consistent with the zero-default-chrome direction.

## Capabilities and Constraints

- **Live-tracked: all 44 lines** (16 Métro incl. 3bis/7bis, RER A-E, Transilien H/J/K/L/N/P/R/U, 15 Tram T1-T14 incl. 3a/3b) — confirmed working against the real feed. Because Next Departures – Global Query returns the entire network's real-time data in a single call, tracking all 44 instead of a subset costs no additional API quota — only more parsing/rendering on our side, so there was no reason to hold any line back to static-only. Trams were added later than the rest via the exact same pipeline (`LINE_REGISTRY` entry + GTFS branch extraction) with zero new logic — the ingestion/rendering layers were already mode-agnostic (nothing in the codebase branches on line mode), confirming the architecture's own open/closed design. Trams keep IDFM's own shortname ("T1", not "1") rather than an invented prefix, since several trams share a Métro line's exact official color (e.g. T8/T10 and Métro 3 are all `#6e6e00`) and the label is what actually disambiguates them.
- Backend polls on a fixed schedule (~90s for positions — the source data itself only refreshes once/minute, so this is close to the real ceiling, not an arbitrary choice; ~2min for disruptions) regardless of connected client/visitor count — the backend is the only thing that ever calls IDFM; browsers only ever talk to our own WebSocket. A hard-coded daily request ceiling in the ingestion code is a safety backstop against bugs (retry storms, reconnect loops), not something normal operation is expected to approach.
- No raw GPS exists anywhere in this feed (confirmed against live responses) — every position is derived from predicted stop times. **Motion is computed continuously on the client**, not snapped between polls: each vehicle's WebSocket payload carries its whole known schedule (fraction-along-line + real predicted time, per remaining stop), and the browser re-evaluates "where is this train right now" every animation frame from that schedule against the real clock. This is what makes movement read as genuinely live rather than as discrete jumps every 90 seconds.
- For rail/RER SIRI calls, the precise stop reference lives in `ArrivalStopAssignment.ExpectedQuayRef`, not the top-level `StopPointRef` (which is a coarser StopArea code there) — a real gotcha found by testing against live data, not documented anywhere obvious.
- **Every RER/Transilien line renders its full real branch structure**, not one cherry-picked representative — e.g. RER A shows all 6 real through-running combinations of its 3 west termini (Cergy-le-Haut, Poissy, Saint-Germain-en-Laye) × 2 east termini (Boissy-Saint-Léger, Marne-la-Vallée-Chessy). Branches were identified by grouping GTFS shape variants by real terminus pair, then filtering out short-turn/peak-only partial services (a greedy longest-first pass: a candidate whose endpoint is already known to be a pass-through station on a longer accepted branch is a partial service, not a genuine terminus, and is discarded) — naive grouping by raw shape count massively overcounts (e.g. RER A has 40 raw shape variants but only 6 real branches). Capped at 8 branches/line.
- **Real-time ingestion picks the correct branch per vehicle**: each journey's resolved stop coordinates are scored against every one of its line's branch polylines (summed nearest-distance), and the schedule is built against whichever branch fits best — not assumed. A journey on the wrong branch would otherwise interpolate onto a track it never runs on.
- **Overlapping lines stay visually distinct via a deterministic per-line pixel offset** (MapLibre's native `line-offset` paint property, stamped server-side per line). Real infrastructure sharing is common (e.g. RER A and E run within ~3m of each other for a stretch near Vincennes) — without an offset, whichever line drew last would paint directly over the other, making it look like one line "disappears into" another. Same convention official transit maps use for shared corridors; purely a rendering choice, doesn't alter real geometry or position data.
- Live disruptions/delays surfaced per line, sourced from IDFM's Traffic Info Messages feed.
- **Bilingual EN/FR, fully, including live disruption text.** UI chrome (wordmark, legend, ticker labels, empty/all-clear states) uses standard static i18n. Disruption messages are dynamic French text from IDFM and are machine-translated server-side: on first sight of a new message string, the backend translates it once and caches the French→English pair in memory, keyed by the original text; every later broadcast of that same message (it's typically active across many poll cycles) reuses the cached translation rather than re-translating. This mirrors the same "poll once, reuse for everyone" discipline used for the IDFM feed itself, and keeps translation-API usage proportional to the number of *distinct* messages per day, not the number of polls or visitors.
- Designed to extend to additional cities later (ingestion adapter per city), but Paris is the only city being built first.
- Undecided: exact final polling intervals, nginx+certbot vs. Caddy for the backend's reverse proxy, whether historical/replay view is ever added (not in scope now).

## Brand Commitments

**Name: "Métropolitain"** — the exact word lettered across every historic Guimard station entrance, reused as the site's own name rather than a coined brand word. This keeps the wordmark and the site's identity literally the same artifact, coherent with the locked visual direction. **Domain: metropolitain.live** — purchased and owned by the user; the `.live` TLD does double duty as both extension and the plain statement that this is real-time, so no separate tagline is needed to clarify that.

## Security & Operational Constraints

- Secrets (IDFM key, DeepL key) live only in server-side `.env` files, never in the client bundle, never committed to git.
- CORS on the backend is locked to the actual frontend origin only — no open/wildcard origin — so no third party can ride our IDFM quota by pointing their own site at our WebSocket/API.
- Mobile is a first-class target, not an afterthought, given expected traffic: the hover-based detail popover needs a tap-based equivalent (tap opens, tap elsewhere or an explicit close dismisses it — no hover-only affordance), and rendering/animation performance must hold up on mid-range phones, not just desktop.
- Accessibility scope is deliberately bounded, not open-ended: the live map canvas itself (motion, position) is inherently visual and not meaningfully screen-reader-accessible, but the ticker, legend, popovers, and all UI chrome get proper contrast, focus states, and ARIA labeling as a text-equivalent baseline. This boundary is a conscious decision, not an omission.
- Social sharing: Open Graph tags (title, description, preview image) so links to the site render properly when shared — preview image still to be designed, likely a static rendered frame of the map in the Guimard's Ironwork style.
- **Playback speed defaults to 1x (strictly real)**, with a visible ×1/×2/×4/×8 control so the viewer opts into faster playback themselves rather than it being silently imposed — real train speed, watched live, is imperceptible at city scale, but the honest baseline stays the default. Switching speed re-anchors every train's virtual clock so the change never causes a visible jump.
- **Data attribution**: IDFM credit lives in the map's own attribution control (the same corner every map already shows tile credit in, no new chrome) — satisfies both the Etalab Open License (static network data) and IDFM's Mobility License (real-time data).
- **Disruptions live in a compact badge + slide-in side panel**, not an always-visible list — the earlier inline list could grow large enough to cover meaningful map area on a busy day. The panel sits over one edge with the map still visible/interactive behind it, rather than a full modal.
- Basic uptime/error monitoring for the backend is planned but deferred past initial launch, not blocking v1.

## Evidence on Hand

IDFM's API catalog, quota structure, and real-time coverage scope (confirmed via the logged-in PRIM account) are now known and documented above. Still missing: an actual API key and a real live feed sample — the exact response shape and per-line/per-branch data quality (GPS vs. predicted-only) remain unconfirmed and must not be assumed or fabricated in UI copy or design claims until verified against a real response.

## Product Principles

1. Observation over utility — routing/trip-planning features are out of scope, permanently, not just for MVP.
2. Every visual signal maps to real data — motion, glow, and pulse effects represent actual feed state, never decorative filler standing in for data we don't have.
3. Glanceable first, detail on demand — the default view reads instantly with no interaction required; deeper per-line/per-station detail is available without cluttering that default view.
4. Built to extend, not rebuilt — Paris ships first, but the ingestion and rendering layers are structured so a second city is a new adapter, not a rewrite.
5. Public and free — no login, no paywall, open on GitHub.
