// Backend API base URL. Production builds default to "/api": the same site
// that serves this page (the backend serves the built frontend). Development
// talks to the local backend. Override either with VITE_API_URL.
const DEFAULT_API_BASE = import.meta.env.PROD ? "/api" : "http://localhost:5000/api";

export const API_BASE = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/$/, "");

// WebSocket origin of the same backend (http -> ws, https -> wss)
function webSocketBase() {
  if (API_BASE.startsWith("/")) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }
  return API_BASE.replace(/^http/, "ws").replace(/\/api$/, "");
}

export const WS_BASE = webSocketBase();
