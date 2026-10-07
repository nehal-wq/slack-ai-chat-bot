const express = require("express");
const crypto = require("crypto");
const { collections, NO_MONGO_ID } = require("./db");
const { bus } = require("./events");
const {
  pageMessages,
  editMessage,
  deleteMessage,
  toggleReaction,
  respond
} = require("./messages");

// Direct (1:1) messages between #general members, stored in MongoDB
// (collections: directMessages, directReads).


// Same key no matter who is "a" and who is "b"
function conversationKey(a, b) {
  return [a, b].sort().join(":");
}

async function addDirectMessage(a, b, message) {
  const fullMessage = {
    id: crypto.randomUUID(),
    conversation: conversationKey(a, b),
    createdAt: new Date().toISOString(),
    ...message
  };
  await collections.directMessages().insertOne({ ...fullMessage });
  // Pushed to both people in the conversation right away
  bus.emit("dm:message", { members: [a, b], message: fullMessage });
  return fullMessage;
}

// Call events shown inside a conversation ("Missed call", "Call ended · 3m")
function addDirectSystemMessage(a, b, text) {
  return addDirectMessage(a, b, { type: "system", text });
}

// Remembers how far a member has read in a conversation
function markRead(conversation, memberId, at) {
  return collections
    .directReads()
    .updateOne(
      { _id: `${conversation}:${memberId}` },
      { $set: { conversation, memberId, lastRead: at } },
      { upsert: true }
    );
}

async function lastReadAt(conversation, memberId) {
  const read = await collections.directReads().findOne({ _id: `${conversation}:${memberId}` });
  return read?.lastRead || "";
}

function createDirectRouter({ findJoinedMember, listJoinedMembers, requireMember }) {
  const router = express.Router();

  // Every DM route needs a signed-in member (sets req.member)
  router.use(requireMember);

  // Resolves the signed-in member and the person they're talking to
  async function resolvePair(req, res) {
    const me = req.member;
    const other = await findJoinedMember(req.params.otherId);
    if (!other || other.id === me.id) {
      res.status(404).json({ error: "That person isn't in the workspace anymore." });
      return null;
    }
    return { me, other, key: conversationKey(me.id, other.id) };
  }

  router.get("/conversations", async (req, res) => {
    const me = req.member;
    const joined = await listJoinedMembers();
    const conversations = await Promise.all(
      joined
        .filter((member) => member.id !== me.id)
        .map(async (member) => {
          const key = conversationKey(me.id, member.id);
          const lastRead = await lastReadAt(key, me.id);
          const [lastMessage, unread] = await Promise.all([
            collections
              .directMessages()
              .findOne({ conversation: key }, { ...NO_MONGO_ID, sort: { createdAt: -1 } }),
            collections.directMessages().countDocuments({
              conversation: key,
              type: "user",
              memberId: { $ne: me.id },
              createdAt: { $gt: lastRead }
            })
          ]);
          return { member, lastMessage: lastMessage || null, unread };
        })
    );

    res.json({ me: joined.find((m) => m.id === me.id), conversations });
  });

  router.get("/:otherId/messages", async (req, res) => {
    const pair = await resolvePair(req, res);
    if (!pair) return;
    // Latest page, or the page before ?before=<createdAt> for older history
    res.json(
      await pageMessages(collections.directMessages(), { conversation: pair.key }, req.query.before)
    );
  });

  // Edits, deletes and reactions are pushed to both people right away
  const announce = (res, pair) => (message) => {
    bus.emit("dm:messageUpdated", { members: [pair.me.id, pair.other.id], message });
    res.json({ message });
  };

  router.patch("/:otherId/messages/:id", async (req, res) => {
    const pair = await resolvePair(req, res);
    if (!pair) return;
    const result = await editMessage(
      collections.directMessages(),
      { conversation: pair.key },
      req.params.id,
      pair.me,
      req.body.text
    );
    respond(res, result, announce(res, pair));
  });

  router.delete("/:otherId/messages/:id", async (req, res) => {
    const pair = await resolvePair(req, res);
    if (!pair) return;
    const result = await deleteMessage(
      collections.directMessages(),
      { conversation: pair.key },
      req.params.id,
      pair.me
    );
    respond(res, result, announce(res, pair));
  });

  router.post("/:otherId/messages/:id/reactions", async (req, res) => {
    const pair = await resolvePair(req, res);
    if (!pair) return;
    const result = await toggleReaction(
      collections.directMessages(),
      { conversation: pair.key },
      req.params.id,
      pair.me,
      req.body.emoji
    );
    respond(res, result, announce(res, pair));
  });

  router.post("/:otherId/messages", async (req, res) => {
    const pair = await resolvePair(req, res);
    if (!pair) return;

    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ error: "Message must not be empty." });
    }

    const message = await addDirectMessage(pair.me.id, pair.other.id, {
      type: "user",
      memberId: pair.me.id,
      author: pair.me.name,
      text: text.slice(0, 4000)
    });
    // Sending implies you've read everything up to your own message
    await markRead(pair.key, pair.me.id, message.createdAt);

    res.status(201).json({ message });
  });

  router.post("/:otherId/read", async (req, res) => {
    const pair = await resolvePair(req, res);
    if (!pair) return;
    await markRead(pair.key, pair.me.id, new Date().toISOString());
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createDirectRouter, addDirectSystemMessage, conversationKey };
