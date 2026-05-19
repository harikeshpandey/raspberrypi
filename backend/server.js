const http = require("http");
const { execFile } = require("child_process");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3001);
const INTERFACE = process.env.WIFI_INTERFACE || "wlan0";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SUDO = process.env.SUDO_PATH || "sudo";
const DNSMASQ_BLOCKLIST = process.env.DNSMASQ_BLOCKLIST || "/etc/dnsmasq.d/pi-panel-blocklist.conf";
let commandInFlight = false;
const sessions = new Set();
const blockedMacs = new Set();
const limitedMacs = new Map();
const blockedSites = new Set();
let lastStationOutput = "Waiting for station data...";

const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  handleApi(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message || "Server error" });
  });
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

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireAdmin(req, res) {
  const token = getToken(req);
  if (!token || !sessions.has(token)) {
    sendJson(res, 401, { error: "Admin login required" });
    return false;
  }

  return true;
}

function isValidMac(mac) {
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac);
}

function normalizeMac(mac) {
  return String(mac || "").trim().toLowerCase();
}

function normalizeSite(site) {
  const value = String(site || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/^\*\./, "");

  if (!/^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(value)) {
    throw new Error("Enter a valid domain, for example youtube.com");
  }

  return value;
}

function classIdForMac(mac) {
  return Number.parseInt(crypto.createHash("sha1").update(mac).digest("hex").slice(0, 3), 16) + 100;
}

function runCommand(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: 10000 }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new Error(output || error.message));
        return;
      }

      resolve(output);
    });

    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

async function sudo(args, input) {
  return runCommand(SUDO, args, input);
}

async function blockMac(mac) {
  await sudo(["iptables", "-C", "FORWARD", "-m", "mac", "--mac-source", mac, "-j", "DROP"]).catch(async () => {
    await sudo(["iptables", "-I", "FORWARD", "1", "-m", "mac", "--mac-source", mac, "-j", "DROP"]);
  });

  await sudo(["iw", "dev", INTERFACE, "station", "del", mac]).catch(() => undefined);
  blockedMacs.add(mac);
}

async function unblockMac(mac) {
  await sudo(["iptables", "-D", "FORWARD", "-m", "mac", "--mac-source", mac, "-j", "DROP"]).catch(() => undefined);
  blockedMacs.delete(mac);
}

async function limitMac(mac, kbps) {
  const rate = Number(kbps);
  if (!Number.isInteger(rate) || rate < 32 || rate > 1000000) {
    throw new Error("Limit must be between 32 and 1000000 Kbps");
  }

  const id = classIdForMac(mac);
  await sudo(["tc", "qdisc", "replace", "dev", INTERFACE, "root", "handle", "1:", "htb", "default", "999"]);
  await sudo(["tc", "class", "replace", "dev", INTERFACE, "parent", "1:", "classid", "1:999", "htb", "rate", "1000mbit", "ceil", "1000mbit"]).catch(() => undefined);
  await sudo(["tc", "class", "replace", "dev", INTERFACE, "parent", "1:", "classid", `1:${id}`, "htb", "rate", `${rate}kbit`, "ceil", `${rate}kbit`]);
  await sudo(["tc", "filter", "replace", "dev", INTERFACE, "protocol", "ip", "parent", "1:", "pref", String(id), "flower", "dst_mac", mac, "classid", `1:${id}`]);
  limitedMacs.set(mac, rate);
}

async function clearLimitMac(mac) {
  const id = classIdForMac(mac);
  await sudo(["tc", "filter", "del", "dev", INTERFACE, "protocol", "ip", "parent", "1:", "pref", String(id)]).catch(() => undefined);
  await sudo(["tc", "class", "del", "dev", INTERFACE, "classid", `1:${id}`]).catch(() => undefined);
  limitedMacs.delete(mac);
}

function siteBlockConfig() {
  return Array.from(blockedSites)
    .sort()
    .map((site) => `address=/${site}/0.0.0.0\naddress=/${site}/::`)
    .join("\n");
}

async function writeSiteBlocklist() {
  await sudo(["tee", DNSMASQ_BLOCKLIST], siteBlockConfig() + "\n");
  await sudo(["systemctl", "restart", "dnsmasq"]);
}

async function blockSite(site) {
  blockedSites.add(site);
  await writeSiteBlocklist();
}

async function unblockSite(site) {
  blockedSites.delete(site);
  await writeSiteBlocklist();
}

function controlState() {
  return {
    blockedMacs: Array.from(blockedMacs),
    limitedMacs: Object.fromEntries(limitedMacs),
    blockedSites: Array.from(blockedSites).sort(),
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    if (body.password !== ADMIN_PASSWORD) {
      sendJson(res, 401, { error: "Wrong admin password" });
      return;
    }

    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    sendJson(res, 200, { token });
    return;
  }

  if (url.pathname === "/api/state") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { ...controlState(), interface: INTERFACE });
    return;
  }

  if (!requireAdmin(req, res)) return;

  const macMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/(block|unblock|limit|clear-limit)$/);
  if (req.method === "POST" && macMatch) {
    const mac = normalizeMac(decodeURIComponent(macMatch[1]));
    if (!isValidMac(mac)) {
      sendJson(res, 400, { error: "Invalid MAC address" });
      return;
    }

    const action = macMatch[2];
    const body = await readJson(req);
    if (action === "block") await blockMac(mac);
    if (action === "unblock") await unblockMac(mac);
    if (action === "limit") await limitMac(mac, body.kbps);
    if (action === "clear-limit") await clearLimitMac(mac);

    sendJson(res, 200, { ok: true, ...controlState() });
    broadcast({ type: "control_state", timestamp: new Date().toISOString(), ...controlState() });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/sites/block" || url.pathname === "/api/sites/unblock")) {
    const body = await readJson(req);
    const site = normalizeSite(body.site);
    if (url.pathname.endsWith("/block")) await blockSite(site);
    if (url.pathname.endsWith("/unblock")) await unblockSite(site);

    sendJson(res, 200, { ok: true, ...controlState() });
    broadcast({ type: "control_state", timestamp: new Date().toISOString(), ...controlState() });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
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
      controls: controlState(),
    });
    lastStationOutput = stdout.trim() || "No stations connected.";
  });
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "connected",
      timestamp: new Date().toISOString(),
      interface: INTERFACE,
      pollIntervalMs: POLL_INTERVAL_MS,
      output: lastStationOutput,
      controls: controlState(),
    })
  );

  runStationDump();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on ws://0.0.0.0:${PORT}`);
  console.log(`Streaming: iw dev ${INTERFACE} station dump`);
});

setInterval(runStationDump, POLL_INTERVAL_MS);
