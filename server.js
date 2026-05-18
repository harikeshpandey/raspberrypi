const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const INTERFACE = process.env.WIFI_INTERFACE || "wlan0";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};
let commandInFlight = false;

function serveStaticFile(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requestPath = parsedUrl.pathname === "/" ? "/index.html" : parsedUrl.pathname;
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  const safePath = path.normalize(decodedPath).replace(/^([/\\])+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer(serveStaticFile);
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

server.listen(PORT, () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  console.log(`Streaming: iw dev ${INTERFACE} station dump`);
});

setInterval(runStationDump, POLL_INTERVAL_MS);
