const express = require("express");
const { createProxyServer } = require("http-proxy");
const { createServer } = require("http");
const path = require("path");

const app = express();
const PORT = 3001;
const COLYSEUS = "http://localhost:2567";

const proxy = createProxyServer();

proxy.on("error", (err, _req, socket) => {
  console.error("Proxy error:", err.message);
  if ("destroy" in socket) socket.destroy();
});

// Proxy API and matchmake requests FIRST (before static)
app.all("/api/{*splat}", (req, res) => {
  proxy.web(req, res, { target: COLYSEUS });
});
app.all("/matchmake/{*splat}", (req, res) => {
  proxy.web(req, res, { target: COLYSEUS });
});

// Serve static React build
app.use(express.static(path.join(__dirname, "client/dist")));

// SPA fallback
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

const server = createServer(app);

// Proxy WebSocket upgrades to Colyseus
server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head, { target: COLYSEUS });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌍 Game available at http://0.0.0.0:${PORT}`);
});
