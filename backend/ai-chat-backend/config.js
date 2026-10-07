// Deployment settings, all from environment variables (see .env.example).
// Defaults are for local development.

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

function list(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

// Sites allowed to call the API and open call connections
const allowedOrigins = [FRONTEND_URL, ...list(process.env.CORS_ORIGINS)];

// Requests without an Origin header (curl, server-to-server) aren't from a
// browser page, so CORS doesn't apply to them; they still need a session.
function isAllowedOrigin(origin) {
  return !origin || allowedOrigins.includes(origin.replace(/\/$/, ""));
}

// STUN finds a direct route between browsers; TURN relays media when strict
// networks block that. Configure a TURN provider for calls across networks.
function iceServers() {
  const servers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];
  const turnUrls = list(process.env.TURN_URLS);
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  return servers;
}

const path = require("path");

module.exports = {
  PORT: Number(process.env.PORT) || 5000,
  // Built frontend (npm run build); served by the backend when it exists
  FRONTEND_DIST: path.resolve(
    __dirname,
    process.env.FRONTEND_DIST || "../../frontend/my-react-app/dist"
  ),
  FRONTEND_URL,
  allowedOrigins,
  isAllowedOrigin,
  iceServers,
  // Number of reverse proxies in front of the app (e.g. 1 on Render/Railway),
  // so rate limits see the real client IP
  TRUST_PROXY: Number(process.env.TRUST_PROXY) || 0
};
