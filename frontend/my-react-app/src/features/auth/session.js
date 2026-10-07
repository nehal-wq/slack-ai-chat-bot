import { API_BASE } from "../../config";

// The session token from an emailed sign-in link (or an accepted invite).
// The server works out who you are from it, so it is the only identity the
// browser keeps.

const SESSION_STORAGE_KEY = "auth.session";
const LEGACY_MEMBER_KEY = "general.memberId";

// Rejection value used when the server says the session is no longer valid
export const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

export function getSessionToken() {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token) {
  try {
    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    // Identity used to be a bare member id; it's no longer trusted
    localStorage.removeItem(LEGACY_MEMBER_KEY);
  } catch {
    // Storage unavailable (private mode); the session lasts for this page only
  }
}

// fetch wrapper for the backend API: adds the session, unwraps JSON errors
export async function apiRequest(path, { method = "GET", body } = {}) {
  const token = getSessionToken();
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error(
      "Unable to reach the server. Check your connection and try again."
    );
  }

  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    setSessionToken(null);
    throw new Error(SESSION_EXPIRED);
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}
