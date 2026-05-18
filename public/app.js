const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const interfaceEl = document.getElementById("interface");
const updatedEl = document.getElementById("updated");

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.addEventListener("open", () => {
    statusEl.textContent = "Connected";
    statusEl.dataset.state = "ok";
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.interface) {
      interfaceEl.textContent = message.interface;
    }

    if (message.timestamp) {
      updatedEl.textContent = formatTimestamp(message.timestamp);
    }

    if (message.type === "station_dump") {
      outputEl.textContent = message.output;
      statusEl.textContent = "Live";
      statusEl.dataset.state = "ok";
    }

    if (message.type === "error") {
      outputEl.textContent = message.output;
      statusEl.textContent = "Command error";
      statusEl.dataset.state = "error";
    }
  });

  socket.addEventListener("close", () => {
    statusEl.textContent = "Disconnected — retrying…";
    statusEl.dataset.state = "warn";
    setTimeout(connect, 1500);
  });

  socket.addEventListener("error", () => {
    socket.close();
  });
}

connect();
