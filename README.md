# Raspberry Pi Wi-Fi Station Monitor

This project is split into:

- `backend/` - Node.js WebSocket server that runs `iw dev wlan0 station dump`
- `frontend/` - React + Tailwind frontend with animated UI

## 1. Install prerequisites on Raspberry Pi

```bash
sudo apt update
sudo apt install -y nodejs npm iw
```

## 2. Install app dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

## 3. Run backend

```bash
cd backend
npm start
```

Default backend address:

```text
ws://<raspberry-pi-ip>:3001
```

## 4. Run frontend

In another terminal:

```bash
cd frontend
npm run dev
```

Then open:

```text
http://<raspberry-pi-ip>:5173
```

## Configuration

Backend:

```bash
WIFI_INTERFACE=wlan0 PORT=3001 POLL_INTERVAL_MS=1000 npm start
```

Frontend:

```bash
VITE_WS_URL=ws://<raspberry-pi-ip>:3001 npm run dev
```

If `VITE_WS_URL` is not set, the frontend uses the current browser hostname with port `3001`.

## Useful checks

Check Wi-Fi interfaces:

```bash
iw dev
```

Check the command manually:

```bash
iw dev wlan0 station dump
```

Check backend health:

```text
http://<raspberry-pi-ip>:3001/health
```
