const http = require("http");
const { execFile } = require("child_process");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3001);
const INTERFACE = process.env.WIFI_INTERFACE || "wlan0";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
let commandInFlight = false;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocket.Server({ server });

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function runStationDump() {
  if (commandInFlight) {
    return;
  }

  commandInFlight = true;
  execFile("iw", ["dev", INTERFACE, "station", "dump"], { timeout: 5000 }, (error, stdout, stderr) => {
    const timestamp = new Date().toISOString();
    commandInFlight = false;

    if (error) {
      broadcast({
        type: "error",
        timestamp,
        interface: INTERFACE,
        output: stderr?.trim() || error.message,
      });
      return;
    }

    broadcast({
      type: "station_dump",
      timestamp,
      interface: INTERFACE,
      output: stdout.trim() || "No stations connected.",
    });
  });
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "connected",
      timestamp: new Date().toISOString(),
      interface: INTERFACE,
      pollIntervalMs: POLL_INTERVAL_MS,
    })
  );

  runStationDump();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on ws://0.0.0.0:${PORT}`);
  console.log(`Streaming: iw dev ${INTERFACE} station dump`);
});

setInterval(runStationDump, POLL_INTERVAL_MS);
