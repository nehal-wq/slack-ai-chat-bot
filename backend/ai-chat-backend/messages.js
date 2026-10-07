const { NO_MONGO_ID } = require("./db");

// Message operations shared by #general (messages collection) and DMs
// (directMessages, scoped by conversation): paging, edit, delete, reactions.

const PAGE_SIZE = 50;
const MAX_TEXT_LENGTH = 4000;

// The reaction picker offers these; anything else is rejected
const REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "🔥", "✅", "👀"];

// One page of messages in `scope`, oldest first. `before` (an ISO timestamp)
// loads the page that comes before it; `hasMore` says if older ones exist.
async function pageMessages(collection, scope, before) {
  const filter = { ...scope };
  if (typeof before === "string" && before) filter.createdAt = { $lt: before };
  const newestFirst = await collection
    .find(filter, NO_MONGO_ID)
    .sort({ createdAt: -1 })
    .limit(PAGE_SIZE + 1)
    .toArray();
  const hasMore = newestFirst.length > PAGE_SIZE;
  return { messages: newestFirst.slice(0, PAGE_SIZE).reverse(), hasMore };
}

function cleanText(text) {
  return typeof text === "string" ? text.trim().slice(0, MAX_TEXT_LENGTH) : "";
}

// Edit your own (non-deleted) message. Returns { message } or { status, error }.
async function editMessage(collection, scope, messageId, member, text) {
  const cleaned = cleanText(text);
  if (!cleaned) return { status: 400, error: "Message must not be empty." };

  const message = await collection.findOne({ ...scope, id: messageId }, NO_MONGO_ID);
  if (!message || message.type !== "user") return { status: 404, error: "Message not found." };
  if (message.memberId !== member.id) {
    return { status: 403, error: "You can only edit your own messages." };
  }
  if (message.deleted) return { status: 400, error: "Deleted messages can't be edited." };

  const updated = await collection.findOneAndUpdate(
    { ...scope, id: messageId },
    { $set: { text: cleaned, editedAt: new Date().toISOString() } },
    { returnDocument: "after", ...NO_MONGO_ID }
  );
  return { message: updated };
}

// Delete a message (kept as a "This message was deleted" placeholder so
// conversations still make sense). `canModerate` lets the workspace owner
// remove anyone's message in #general.
async function deleteMessage(collection, scope, messageId, member, canModerate = false) {
  const message = await collection.findOne({ ...scope, id: messageId }, NO_MONGO_ID);
  if (!message || message.type === "system") return { status: 404, error: "Message not found." };
  const isAuthor = message.memberId === member.id;
  if (!isAuthor && !canModerate) {
    return { status: 403, error: "You can only delete your own messages." };
  }
  if (message.deleted) return { message };

  const updated = await collection.findOneAndUpdate(
    { ...scope, id: messageId },
    {
      $set: { deleted: true, text: "", deletedAt: new Date().toISOString() },
      $unset: { reactions: "", editedAt: "" }
    },
    { returnDocument: "after", ...NO_MONGO_ID }
  );
  return { message: updated };
}

// Add your reaction, or remove it if you already reacted with that emoji
async function toggleReaction(collection, scope, messageId, member, emoji) {
  if (!REACTIONS.includes(emoji)) return { status: 400, error: "Unsupported reaction." };

  const message = await collection.findOne({ ...scope, id: messageId }, NO_MONGO_ID);
  if (!message || message.type === "system" || message.deleted) {
    return { status: 404, error: "Message not found." };
  }

  const field = `reactions.${emoji}`;
  const alreadyReacted = (message.reactions?.[emoji] || []).includes(member.id);
  let updated = await collection.findOneAndUpdate(
    { ...scope, id: messageId },
    alreadyReacted ? { $pull: { [field]: member.id } } : { $addToSet: { [field]: member.id } },
    { returnDocument: "after", ...NO_MONGO_ID }
  );
  // Drop emojis nobody uses anymore
  if (alreadyReacted && updated.reactions?.[emoji]?.length === 0) {
    updated = await collection.findOneAndUpdate(
      { ...scope, id: messageId },
      { $unset: { [field]: "" } },
      { returnDocument: "after", ...NO_MONGO_ID }
    );
  }
  return { message: updated };
}

// Sends { status, error } results as errors, otherwise calls onSuccess
function respond(res, result, onSuccess) {
  if (result.error) return res.status(result.status).json({ error: result.error });
  return onSuccess(result.message);
}

module.exports = {
  PAGE_SIZE,
  REACTIONS,
  pageMessages,
  editMessage,
  deleteMessage,
  toggleReaction,
  respond
};
