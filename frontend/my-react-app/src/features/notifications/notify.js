// Desktop notifications and the incoming-call ringtone. Both are per-device
// preferences stored in localStorage.

const DESKTOP_KEY = "notify.desktop";
const SOUND_KEY = "notify.sound";

function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the choice lasts for this visit only
  }
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

// Desktop notifications are on only if the person turned them on here AND
// the browser allows them
export function desktopNotificationsEnabled() {
  return readPref(DESKTOP_KEY) === "on" && notificationPermission() === "granted";
}

// Must be called from a click: browsers only show the permission prompt then
export async function enableDesktopNotifications() {
  if (!notificationsSupported()) return "unsupported";
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission === "granted") writePref(DESKTOP_KEY, "on");
  return permission;
}

export function disableDesktopNotifications() {
  writePref(DESKTOP_KEY, "off");
}

export function callSoundEnabled() {
  return readPref(SOUND_KEY) !== "off";
}

export function setCallSoundEnabled(on) {
  writePref(SOUND_KEY, on ? "on" : "off");
}

// Shows a desktop notification if enabled. `tag` replaces an earlier
// notification with the same tag instead of stacking.
export function showNotification({ title, body, tag, onClick }) {
  if (!desktopNotificationsEnabled()) return;
  try {
    const notification = new Notification(title, { body, tag, icon: "/icon-192.png" });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker
  }
}

// A soft two-tone ring, repeated until stopped. Generated with Web Audio so
// there's no sound file to ship. Returns a function that stops it.
export function startRingtone() {
  if (!callSoundEnabled()) return () => {};
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return () => {};

  const context = new AudioContextClass();
  const playRing = () => {
    const start = context.currentTime;
    [
      [659, 0],
      [523, 0.18],
      [659, 0.5],
      [523, 0.68]
    ].forEach(([frequency, offset]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(0.18, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.17);
    });
  };

  playRing();
  const timer = setInterval(playRing, 2500);
  return () => {
    clearInterval(timer);
    context.close().catch(() => {});
  };
}
