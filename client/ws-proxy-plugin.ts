import type { Plugin } from "vite";
import pkg from "http-proxy";
const { createProxyServer } = pkg;

export function colyseusWsProxy(): Plugin {
  return {
    name: "colyseus-ws-proxy",
    configureServer(server) {
      const proxy = createProxyServer({ target: "ws://localhost:2567", ws: true });
      proxy.on("error", (_err: any, _req: any, socket: any) => {
        if ("destroy" in socket) socket.destroy();
      });

      server.httpServer?.on("upgrade", (req: any, socket: any, head: any) => {
        const url = req.url || "";
        if (url === "/__vite_hmr" || url.startsWith("/@")) return;
        proxy.ws(req, socket, head);
      });
    },
  };
}
