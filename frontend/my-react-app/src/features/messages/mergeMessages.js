// Helpers for message lists (oldest first) shared by #general and DMs.

// A refresh returns only the latest page. Keep any older messages already
// loaded with "Load older messages" instead of dropping them.
export function mergeLatest(existing, latest) {
  if (!latest.length) return latest;
  const oldestLatest = latest[0].createdAt;
  const older = existing.filter((m) => m.createdAt < oldestLatest);
  return [...older, ...latest];
}

export function hasOlderThan(existing, latest) {
  return Boolean(existing.length && latest.length && existing[0].createdAt < latest[0].createdAt);
}

export function prependOlder(existing, older) {
  const ids = new Set(existing.map((m) => m.id));
  return [...older.filter((m) => !ids.has(m.id)), ...existing];
}

// Swap in an edited/deleted/reacted copy of a message, if we have it
export function replaceMessage(list, message) {
  const index = list.findIndex((m) => m.id === message.id);
  if (index !== -1) list[index] = message;
}
