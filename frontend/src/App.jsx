import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

const defaultWsUrl = `ws://${window.location.hostname}:3001`;
const WS_URL = import.meta.env.VITE_WS_URL || defaultWsUrl;

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
      mac,
      signal: details.signal || "-",
      txBitrate: details["tx bitrate"] || "-",
      rxBitrate: details["rx bitrate"] || "-",
      connectedTime: details["connected time"] || "-",
      inactiveTime: details["inactive time"] || "-",
    };
  });
}

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [statusTone, setStatusTone] = useState("warn");
  const [interfaceName, setInterfaceName] = useState("-");
  const [updatedAt, setUpdatedAt] = useState("-");
  const [rawOutput, setRawOutput] = useState("Waiting for station data...");
  const [showRawOutput, setShowRawOutput] = useState(true);
  const stations = useMemo(() => parseStations(rawOutput), [rawOutput]);

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

        if (message.type === "station_dump") {
          setRawOutput(message.output);
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

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <section className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.24em] text-sky-300">Raspberry Pi</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Wi-Fi station monitor</h1>
          <p className="mt-3 text-sm text-slate-400">
            Live output from <code className="text-sky-200">iw dev wlan0 station dump</code>
          </p>
        </div>

        <motion.div
          layout
          className="flex min-w-48 items-center gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur"
        >
          <span className={`h-3 w-3 rounded-full ${toneClasses[statusTone]}`} />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Connection</p>
            <p className={`mt-1 text-sm ${toneClasses[statusTone].split(" ")[1]}`}>{status}</p>
          </div>
        </motion.div>
      </section>

      <section className="mb-4 grid gap-4 md:grid-cols-3">
        {[
          ["Interface", interfaceName],
          ["Connected stations", stations.length],
          ["Last update", updatedAt],
        ].map(([label, value]) => (
          <motion.article
            key={label}
            layout
            className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
            <p className="mt-3 text-2xl font-semibold">{value}</p>
          </motion.article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="border-b border-white/10 px-5 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Clients</p>
            <h2 className="mt-1 text-xl font-semibold">Stations</h2>
          </div>

          <div className="grid gap-4 p-5">
            <AnimatePresence mode="popLayout">
              {stations.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-white/10 text-slate-400"
                >
                  No stations connected.
                </motion.div>
              ) : (
                stations.map((station) => (
                  <motion.article
                    layout
                    key={station.mac}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="font-medium">{station.mac}</h3>
                      <span className="text-sm text-emerald-300">{station.signal}</span>
                    </div>

                    <dl className="grid gap-4 sm:grid-cols-2">
                      {[
                        ["TX bitrate", station.txBitrate],
                        ["RX bitrate", station.rxBitrate],
                        ["Connected", station.connectedTime],
                        ["Inactive", station.inactiveTime],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</dt>
                          <dd className="mt-1 text-sm text-slate-200">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </motion.article>
                ))
              )}
            </AnimatePresence>
          </div>
        </article>

        <article className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Terminal view</p>
              <h2 className="mt-1 text-xl font-semibold">Raw output</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowRawOutput((value) => !value)}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
            >
              {showRawOutput ? "Hide" : "Show"}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {showRawOutput && (
              <motion.pre
                key="raw-output"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="min-h-96 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm leading-6 text-sky-100"
              >
                {rawOutput}
              </motion.pre>
            )}
          </AnimatePresence>
        </article>
      </section>
    </main>
  );
}

export default App;
