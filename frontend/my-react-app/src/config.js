export const API_BASE = "http://localhost:5000/api";

// WebSocket origin of the same backend (http -> ws, https -> wss)
export const WS_BASE = API_BASE.replace(/^http/, "ws").replace(/\/api$/, "");
