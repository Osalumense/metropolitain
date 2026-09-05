import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config/index.js";
import { networkGeoJSON } from "./network.js";
import type { VehicleState, DisruptionState } from "./types/index.js";
import { fetchVehicles, fetchDisruptions } from "./idfmIngestion.js";

const app = express();
app.disable("x-powered-by"); // don't hand attackers free framework fingerprinting
// Comma-separated so both the apex and www can be allowed — nginx serves the same app on
// both hosts with no redirect between them, so a visitor landing on www (bookmark, browser
// autofill, a shared link) was getting every API call silently blocked by the browser's own
// CORS enforcement when this only listed the apex: the server's 204 response looked fine in
// curl, but Access-Control-Allow-Origin didn't match the page's actual origin, so the browser
// discarded it — a real, deterministic bug, not a fluke tied to any one visitor's setup.
app.use(cors({ origin: config.frontendOrigins }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/network", (_req, res) => {
  res.json(networkGeoJSON());
});

const httpServer = createServer(app);
const wss = new WebSocketServer({
  server: httpServer,
  path: "/ws",
  // A real browser always sends an Origin header on a cross-origin WebSocket connection —
  // unspoofable by the page's own JS — so this closes the one gap our REST CORS didn't
  // cover: someone else's site pointing its own client straight at our socket. A script
  // with a deliberately forged Origin isn't stopped by this any more than curl bypasses
  // CORS today; that's not what this is for. Requests with no Origin at all (non-browser
  // tools — our own diagnostics included) are left alone rather than blocked.
  verifyClient: (info: { origin: string }) => !info.origin || config.frontendOrigins.includes(info.origin),
});

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

async function positionLoop() {
  try {
    latestVehicles = await fetchVehicles();
    broadcast({ type: "positions", data: latestVehicles });
  } catch (err) {
    console.error("[positionLoop] failed:", err);
  }
}

async function disruptionLoop() {
  try {
    latestDisruptions = await fetchDisruptions();
    broadcast({ type: "disruptions", data: latestDisruptions });
  } catch (err) {
    console.error("[disruptionLoop] failed:", err);
  }
}

setInterval(positionLoop, config.positionIntervalMs);
setInterval(disruptionLoop, config.disruptionIntervalMs);
positionLoop();
disruptionLoop();

httpServer.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] CORS locked to ${config.frontendOrigins.join(", ")}`);
  console.log(`[server] LIVE IDFM data — positions every ${config.positionIntervalMs}ms, disruptions every ${config.disruptionIntervalMs}ms`);
});
