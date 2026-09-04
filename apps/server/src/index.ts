import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { networkGeoJSON } from "./network.js";
import { MockIngestion, type VehicleState, type DisruptionState } from "./mockIngestion.js";
import { fetchVehicles, fetchDisruptions } from "./idfmIngestion.js";

const PORT = Number(process.env.PORT ?? 4000);
// Comma-separated so both the apex and www can be allowed — nginx serves the same app on
// both hosts with no redirect between them, so a visitor landing on www (bookmark, browser
// autofill, a shared link) was getting every API call silently blocked by the browser's own
// CORS enforcement when this only listed the apex: the server's 204 response looked fine in
// curl, but Access-Control-Allow-Origin didn't match the page's actual origin, so the browser
// discarded it — a real, deterministic bug, not a fluke tied to any one visitor's setup.
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim());
const USE_REAL_DATA = Boolean(process.env.PRIM_API_KEY);

// Mock loop isn't subject to any quota, so it can tick fast for visible motion in dev.
// Real IDFM polling follows the cadence from PRODUCT.md: positions ~90s (the feed itself
// only refreshes once/minute, so faster gains nothing), disruptions ~2min (7 calls/cycle,
// one per tracked line — see idfmIngestion.ts for why a single global call isn't possible).
const POSITION_INTERVAL_MS = Number(process.env.POSITION_INTERVAL_MS ?? (USE_REAL_DATA ? 90_000 : 4_000));
const DISRUPTION_INTERVAL_MS = Number(process.env.DISRUPTION_INTERVAL_MS ?? (USE_REAL_DATA ? 120_000 : 4_000));

const app = express();
app.use(cors({ origin: FRONTEND_ORIGINS }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", realData: USE_REAL_DATA });
});

app.get("/api/network", (_req, res) => {
  res.json(networkGeoJSON());
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

let latestVehicles: VehicleState[] = [];
let latestDisruptions: DisruptionState[] = [];

function broadcast(payload: unknown) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

wss.on("connection", (socket) => {
  console.log(`[ws] client connected (${wss.clients.size} total)`);
  socket.send(JSON.stringify({ type: "positions", data: latestVehicles }));
  socket.send(JSON.stringify({ type: "disruptions", data: latestDisruptions }));
  socket.on("close", () => console.log(`[ws] client disconnected (${wss.clients.size} total)`));
});

const mock = USE_REAL_DATA ? null : new MockIngestion();

async function positionLoop() {
  try {
    if (USE_REAL_DATA) {
      latestVehicles = await fetchVehicles();
    } else {
      const tick = await mock!.tick();
      latestVehicles = tick.vehicles;
      latestDisruptions = tick.disruptions; // mock bundles both in one tick
    }
    broadcast({ type: "positions", data: latestVehicles });
    if (!USE_REAL_DATA) broadcast({ type: "disruptions", data: latestDisruptions });
  } catch (err) {
    console.error("[positionLoop] failed:", err);
  }
}

async function disruptionLoop() {
  if (!USE_REAL_DATA) return; // mock handles disruptions inside positionLoop
  try {
    latestDisruptions = await fetchDisruptions();
    broadcast({ type: "disruptions", data: latestDisruptions });
  } catch (err) {
    console.error("[disruptionLoop] failed:", err);
  }
}

setInterval(positionLoop, POSITION_INTERVAL_MS);
setInterval(disruptionLoop, DISRUPTION_INTERVAL_MS);
positionLoop();
disruptionLoop();

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] CORS locked to ${FRONTEND_ORIGINS.join(", ")}`);
  if (USE_REAL_DATA) {
    console.log(`[server] LIVE IDFM data — positions every ${POSITION_INTERVAL_MS}ms, disruptions every ${DISRUPTION_INTERVAL_MS}ms`);
  } else {
    console.log(`[server] mock ingestion tick every ${POSITION_INTERVAL_MS}ms — NOT real IDFM data`);
  }
});
