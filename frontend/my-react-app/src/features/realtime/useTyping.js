import { useState, useEffect } from "react";
import { subscribe, sendRealtime } from "./realtimeBus";

// Typing indicators. Senders signal at most every TYPING_SEND_MS; a typer is
// shown for TYPING_SHOW_MS after their last signal, or until their message
// arrives.
const TYPING_SEND_MS = 2000;
const TYPING_SHOW_MS = 4000;

const lastSentAt = new Map();

// Call on every keystroke; signals are throttled per conversation
export function notifyTyping(target, to) {
  const key = target === "dm" ? `dm:${to}` : target;
  if (Date.now() - (lastSentAt.get(key) || 0) < TYPING_SEND_MS) return;
  lastSentAt.set(key, Date.now());
  sendRealtime({ type: "typing", target, to });
}

// Names of people currently typing in #general (target "general") or in the
// DM with otherId (target "dm")
export function useTypingNames(target, otherId) {
  const [typers, setTypers] = useState({}); // memberId -> { name, until }

  useEffect(() => {
    const relevant = (event) =>
      event.target === target && (target !== "dm" || event.from === otherId);

    const stopTyping = (memberId) =>
      setTypers((current) => {
        if (!current[memberId]) return current;
        const next = { ...current };
        delete next[memberId];
        return next;
      });

    const unsubscribers = [
      subscribe("typing", (event) => {
        if (!relevant(event)) return;
        setTypers((current) => ({
          ...current,
          [event.from]: { name: event.name, until: Date.now() + TYPING_SHOW_MS }
        }));
      }),
      // Their message arrived: they're done typing
      subscribe("general:message", ({ message }) => {
        if (target === "general" && message.memberId) stopTyping(message.memberId);
      }),
      subscribe("dm:message", ({ message }) => {
        if (target === "dm" && message.memberId === otherId) stopTyping(otherId);
      })
    ];

    const timer = setInterval(() => {
      setTypers((current) => {
        const now = Date.now();
        const active = Object.entries(current).filter(([, typer]) => typer.until > now);
        return active.length === Object.keys(current).length ? current : Object.fromEntries(active);
      });
    }, 1000);

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      clearInterval(timer);
      setTypers({});
    };
  }, [target, otherId]);

  return Object.values(typers).map((typer) => typer.name);
}

export function typingLabel(names) {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}
