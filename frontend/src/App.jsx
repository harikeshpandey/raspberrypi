import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

const defaultWsUrl = `ws://${window.location.hostname}:3001`;
const WS_URL = import.meta.env.VITE_WS_URL || defaultWsUrl;
const API_URL = WS_URL.replace(/^ws/, "http").replace(/\/$/, "");

function parseStations(output) {
  if (!output || output === "No stations connected.") {
    return [];
  }

  const blocks = output
    .split(/^Station /m)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim());
    const [firstLine, ...rest] = lines;
    const [mac = "Unknown"] = firstLine.split(/\s+/);
    const details = {};

    for (const line of rest) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) continue;

      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      details[key] = value;
    }

    return {
      mac: mac.toLowerCase(),
      signal: details.signal || "-",
      txBitrate: details["tx bitrate"] || "-",
      rxBitrate: details["rx bitrate"] || "-",
      connectedTime: details["connected time"] || "-",
      inactiveTime: details["inactive time"] || "-",
    };
  });
}

function App() {
  const [adminToken, setAdminToken] = useState(() => window.localStorage.getItem("adminToken") || "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [status, setStatus] = useState("Connecting...");
  const [statusTone, setStatusTone] = useState("warn");
  const [interfaceName, setInterfaceName] = useState("-");
  const [updatedAt, setUpdatedAt] = useState("-");
  const [rawOutput, setRawOutput] = useState("Waiting for station data...");
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [controls, setControls] = useState({ blockedMacs: [], limitedMacs: {}, blockedSites: [] });
  const [site, setSite] = useState("");
  const [limitInputs, setLimitInputs] = useState({});
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const stations = useMemo(() => parseStations(rawOutput), [rawOutput]);

  const authedFetch = async (path, body = {}) => {
    setActionError("");
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }
    if (data.blockedMacs) {
      setControls({
        blockedMacs: data.blockedMacs,
        limitedMacs: data.limitedMacs || {},
        blockedSites: data.blockedSites || [],
      });
    }
    return data;
  };

  const runAction = async (id, callback) => {
    setBusyAction(id);
    try {
      await callback();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction("");
    }
  };

  const login = async (event) => {
    event.preventDefault();
    setLoginError("");
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      window.localStorage.setItem("adminToken", data.token);
      setAdminToken(data.token);
      setPassword("");
    } catch (error) {
      setLoginError(error.message);
    }
  };

  useEffect(() => {
    if (!adminToken) return undefined;

    fetch(`${API_URL}/api/state`, { headers: { Authorization: `Bearer ${adminToken}` } })
      .then((response) => {
        if (response.status === 401) {
          window.localStorage.removeItem("adminToken");
          setAdminToken("");
        }
        return response.json();
      })
      .then((data) => {
        if (data?.blockedMacs) {
          setControls(data);
        }
      })
      .catch(() => undefined);

    return undefined;
  }, [adminToken]);

  useEffect(() => {
    let retryTimer;
    let socket;

    const connect = () => {
      socket = new WebSocket(WS_URL);

      socket.addEventListener("open", () => {
        setStatus("Connected");
        setStatusTone("ok");
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);

        if (message.interface) {
          setInterfaceName(message.interface);
        }

        if (message.timestamp) {
          setUpdatedAt(
            new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          );
        }

        if (message.output) {
          setRawOutput(message.output);
        }

        if (message.controls) {
          setControls(message.controls);
        }

        if (message.type === "station_dump") {
          setStatus("Live");
          setStatusTone("ok");
        }

        if (message.type === "error") {
          setRawOutput(message.output);
          setStatus("Command error");
          setStatusTone("error");
        }
      });

      socket.addEventListener("close", () => {
        setStatus("Disconnected - retrying...");
        setStatusTone("warn");
        retryTimer = window.setTimeout(connect, 1500);
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    };

    connect();

    return () => {
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  const toneClasses = {
    ok: "bg-emerald-400 text-emerald-300",
    warn: "bg-amber-400 text-amber-200",
    error: "bg-rose-400 text-rose-200",
  };

  if (!adminToken) {
    return (
      <main className="grid min-h-screen place-items-center px-4 text-slate-100">
        <form onSubmit={login} className="w-full max-w-sm rounded-lg border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/30">
          <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Raspberry Pi</p>
          <h1 className="mt-2 text-2xl font-semibold">Admin login</h1>
          <label className="mt-6 block text-sm text-slate-300" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-sky-400"
            autoComplete="current-password"
            autoFocus
          />
          {loginError && <p className="mt-3 text-sm text-rose-300">{loginError}</p>}
          <button type="submit" className="mt-5 w-full rounded-md bg-sky-400 px-4 py-2 font-medium text-slate-950 transition hover:bg-sky-300">
            Sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <section className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-sky-300">Raspberry Pi</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Wi-Fi admin panel</h1>
          <p className="mt-3 text-sm text-slate-400">
            Live stations and network controls for <code className="text-sky-200">{interfaceName}</code>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <motion.div layout className="flex min-w-48 items-center gap-3 rounded-lg border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur">
            <span className={`h-3 w-3 rounded-full ${toneClasses[statusTone]}`} />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Connection</p>
              <p className={`mt-1 text-sm ${toneClasses[statusTone].split(" ")[1]}`}>{status}</p>
            </div>
          </motion.div>
          <button
            type="button"
            onClick={() => {
              window.localStorage.removeItem("adminToken");
              setAdminToken("");
            }}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            Logout
          </button>
        </div>
      </section>

      <section className="mb-4 grid gap-4 md:grid-cols-3">
        {[
          ["Interface", interfaceName],
          ["Connected stations", stations.length],
          ["Last update", updatedAt],
        ].map(([label, value]) => (
          <motion.article key={label} layout className="rounded-lg border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
            <p className="mt-3 text-2xl font-semibold">{value}</p>
          </motion.article>
        ))}
      </section>

      {actionError && <div className="mb-4 rounded-md border border-rose-400/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{actionError}</div>}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/70 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="border-b border-white/10 px-5 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Clients</p>
            <h2 className="mt-1 text-xl font-semibold">Stations</h2>
          </div>

          <div className="grid gap-4 p-5">
            <AnimatePresence mode="popLayout">
              {stations.length === 0 ? (
                <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="grid min-h-52 place-items-center rounded-lg border border-dashed border-white/10 text-slate-400">
                  No stations connected.
                </motion.div>
              ) : (
                stations.map((station) => {
                  const isBlocked = controls.blockedMacs.includes(station.mac);
                  const limit = controls.limitedMacs[station.mac];
                  const limitValue = limitInputs[station.mac] ?? limit ?? 512;

                  return (
                    <motion.article layout key={station.mac} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-lg border border-white/10 bg-slate-950/40 p-4">
                      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                          <h3 className="font-medium">{station.mac}</h3>
                          <p className="mt-1 text-sm text-emerald-300">{station.signal}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isBlocked && <span className="rounded-md bg-rose-400/10 px-2 py-1 text-xs text-rose-200">Blocked</span>}
                          {limit && <span className="rounded-md bg-amber-400/10 px-2 py-1 text-xs text-amber-200">{limit} Kbps</span>}
                        </div>
                      </div>

                      <dl className="mb-4 grid gap-4 sm:grid-cols-2">
                        {[
                          ["TX bitrate", station.txBitrate],
                          ["RX bitrate", station.rxBitrate],
                          ["Connected", station.connectedTime],
                          ["Inactive", station.inactiveTime],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</dt>
                            <dd className="mt-1 text-sm text-slate-200">{value}</dd>
                          </div>
                        ))}
                      </dl>

                      <div className="flex flex-col gap-3 border-t border-white/10 pt-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyAction === `${station.mac}:block`}
                            onClick={() => runAction(`${station.mac}:block`, () => authedFetch(`/api/clients/${station.mac}/${isBlocked ? "unblock" : "block"}`))}
                            className="rounded-md border border-white/10 px-3 py-2 text-sm transition hover:bg-white/10 disabled:opacity-50"
                          >
                            {isBlocked ? "Unblock" : "Block"}
                          </button>
                          {limit && (
                            <button
                              type="button"
                              disabled={busyAction === `${station.mac}:clear-limit`}
                              onClick={() => runAction(`${station.mac}:clear-limit`, () => authedFetch(`/api/clients/${station.mac}/clear-limit`))}
                              className="rounded-md border border-white/10 px-3 py-2 text-sm transition hover:bg-white/10 disabled:opacity-50"
                            >
                              Clear limit
                            </button>
                          )}
                        </div>

                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            runAction(`${station.mac}:limit`, () => authedFetch(`/api/clients/${station.mac}/limit`, { kbps: Number(limitValue) }));
                          }}
                        >
                          <input
                            type="number"
                            min="32"
                            max="1000000"
                            value={limitValue}
                            onChange={(event) => setLimitInputs((values) => ({ ...values, [station.mac]: event.target.value }))}
                            className="w-28 rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-400"
                          />
                          <button type="submit" disabled={busyAction === `${station.mac}:limit`} className="rounded-md bg-sky-400 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:opacity-50">
                            Limit Kbps
                          </button>
                        </form>
                      </div>
                    </motion.article>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </article>

        <div className="grid gap-4 content-start">
          <article className="rounded-lg border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Site blocking</p>
            <h2 className="mt-1 text-xl font-semibold">Blocked domains</h2>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                runAction("site:block", async () => {
                  await authedFetch("/api/sites/block", { site });
                  setSite("");
                });
              }}
            >
              <input
                type="text"
                value={site}
                onChange={(event) => setSite(event.target.value)}
                placeholder="youtube.com"
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-400"
              />
              <button type="submit" disabled={busyAction === "site:block"} className="rounded-md bg-sky-400 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:opacity-50">
                Block
              </button>
            </form>

            <div className="mt-4 grid gap-2">
              {controls.blockedSites.length === 0 ? (
                <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400">No sites blocked.</p>
              ) : (
                controls.blockedSites.map((blockedSite) => (
                  <div key={blockedSite} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/40 px-3 py-2">
                    <span className="min-w-0 break-words text-sm">{blockedSite}</span>
                    <button
                      type="button"
                      disabled={busyAction === `site:${blockedSite}`}
                      onClick={() => runAction(`site:${blockedSite}`, () => authedFetch("/api/sites/unblock", { site: blockedSite }))}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs transition hover:bg-white/10 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/70 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Terminal view</p>
                <h2 className="mt-1 text-xl font-semibold">Raw output</h2>
              </div>
              <button type="button" onClick={() => setShowRawOutput((value) => !value)} className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10">
                {showRawOutput ? "Hide" : "Show"}
              </button>
            </div>

            <AnimatePresence initial={false}>
              {showRawOutput && (
                <motion.pre key="raw-output" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm leading-6 text-sky-100">
                  {rawOutput}
                </motion.pre>
              )}
            </AnimatePresence>
          </article>
        </div>
      </section>
    </main>
  );
}

export default App;
