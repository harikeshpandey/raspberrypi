# Raspberry Pi Wi-Fi Station Monitor

This app runs:

```bash
iw dev wlan0 station dump
```

on the Raspberry Pi every second and streams the latest output to a browser over WebSocket.

## Project layout

- `server.js` - HTTP server, WebSocket server, and command runner
- `public/` - browser UI

## Run on Raspberry Pi

1. Install prerequisites:

```bash
sudo apt update
sudo apt install -y nodejs npm iw
```

2. From the project folder:

```bash
npm install
npm start
```

3. Open the app from another device on the same network:

```text
http://<raspberry-pi-ip>:3000
```

## Configuration

You can change the interface, port, or polling interval:

```bash
WIFI_INTERFACE=wlan0 PORT=3000 POLL_INTERVAL_MS=1000 npm start
```

## Notes

- The command must work in the Pi terminal first:

```bash
iw dev wlan0 station dump
```

- If your Wi-Fi interface has a different name, check it with:

```bash
iw dev
```

- If `iw` returns a permission error, run the app with enough privileges for your Pi setup or adjust system permissions appropriately.
