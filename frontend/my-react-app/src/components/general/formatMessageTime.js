export default function formatMessageTime(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) {
    return time;
  }
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
