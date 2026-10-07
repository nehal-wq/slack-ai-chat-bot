// Tiny pub/sub around the app's one realtime WebSocket (owned by useHuddle).
// Chat features subscribe to pushed events ("general:message", "dm:message",
// "presence", "typing", ...) and send small signals like "typing" without
// needing their own connection.

const listeners = new Map(); // type -> Set<handler>
let sender = null;

export function subscribe(type, handler) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(handler);
  return () => listeners.get(type)?.delete(handler);
}

export function publish(message) {
  for (const handler of listeners.get(message.type) || []) {
    try {
      handler(message);
    } catch (error) {
      console.error("Realtime handler failed:", error);
    }
  }
}

// useHuddle registers how to send on the socket while it's connected
export function setRealtimeSender(send) {
  sender = send;
}

export function sendRealtime(message) {
  sender?.(message);
}
