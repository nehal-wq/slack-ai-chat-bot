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

// Channels beyond #general. All channel messages live in the `messages`
// collection with a `channel` field; #general is the channel "general".
//
// Public channels: every workspace member can see, preview and join them.
// Private channels: only their members can see them, read them or be told
// about them (pushes go to members only).

const GENERAL_ID = "general";
const MAX_TOPIC_LENGTH = 250;
const BOT_MENTION_PATTERN = /@(ai|slack ai)\b/i;

// "Marketing Team!" -> "marketing-team"
function cleanChannelName(name) {
  return (typeof name === "string" ? name : "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40);
}

function cleanTopic(topic) {
  return typeof topic === "string" ? topic.trim().slice(0, MAX_TOPIC_LENGTH) : "";
}

// What clients see about a channel
function publicChannel(channel, memberId) {
  const { _id, ...rest } = channel;
  return { ...rest, joined: channel.members.includes(memberId) };
}

// null = everyone signed in may hear about it; otherwise just these members
function audienceOf(channel) {
  return channel.private ? channel.members : null;
}

function canRead(channel, member) {
  return !channel.private || channel.members.includes(member.id);
}

function isMember(channel, member) {
  return channel.members.includes(member.id);
}

function findChannel(id) {
  if (typeof id !== "string" || id === GENERAL_ID) return null;
  return collections.channels().findOne({ id }, NO_MONGO_ID);
}

// Created on startup: #general's channel record, and messages saved before
// channels existed get tagged as #general
async function ensureChannels() {
  await collections.channels().updateOne(
    { id: GENERAL_ID },
    {
      $setOnInsert: {
        id: GENERAL_ID,
        name: "general",
        topic: "Team conversation",
        private: false,
        members: [],
        createdAt: new Date().toISOString()
      }
    },
    { upsert: true }
  );
  await collections
    .messages()
    .updateMany({ channel: { $exists: false } }, { $set: { channel: GENERAL_ID } });
}

// Removed workspace members leave every channel
function removeFromAllChannels(memberId) {
  return collections.channels().updateMany({}, { $pull: { members: memberId } });
}

// For realtime typing: may this member signal in the channel, and who hears it?
async function channelAudience(channelId, memberId) {
  const channel = await findChannel(channelId);
  if (!channel || !channel.members.includes(memberId)) return null;
  return { audience: audienceOf(channel) };
}

function createChannelsRouter({ requireMember, getAIResponse, replyAsBot }) {
  const router = express.Router();
  router.use(requireMember);

  async function addChannelMessage(channel, message) {
    const fullMessage = {
      id: crypto.randomUUID(),
      channel: channel.id,
      createdAt: new Date().toISOString(),
      ...message
    };
    await collections.messages().insertOne({ ...fullMessage });
    bus.emit("channel:message", {
      channelId: channel.id,
      message: fullMessage,
      audience: audienceOf(channel)
    });
    return fullMessage;
  }

  // The channel list changed for these people (null = everyone)
  function announceChanged(audience) {
    bus.emit("channels:changed", { audience });
  }

  async function loadReadable(req, res) {
    const channel = await findChannel(req.params.id);
    if (!channel || !canRead(channel, req.member)) {
      res.status(404).json({ error: "Channel not found." });
      return null;
    }
    return channel;
  }

  async function updateChannel(id, update) {
    return collections
      .channels()
      .findOneAndUpdate({ id }, update, { returnDocument: "after", ...NO_MONGO_ID });
  }

  // Channels you can see: every public one, plus private ones you're in
  router.get("/", async (req, res) => {
    const channels = await collections
      .channels()
      .find(
        {
          id: { $ne: GENERAL_ID },
          $or: [{ private: false }, { members: req.member.id }]
        },
        NO_MONGO_ID
      )
      .sort({ name: 1 })
      .toArray();
    res.json({ channels: channels.map((c) => publicChannel(c, req.member.id)) });
  });

  router.post("/", async (req, res) => {
    const name = cleanChannelName(req.body.name);
    if (!name) {
      return res
        .status(400)
        .json({ error: "Channel names use lowercase letters, numbers, - and _." });
    }
    if (await collections.channels().findOne({ name })) {
      return res.status(409).json({ error: `#${name} already exists.` });
    }

    const channel = {
      id: crypto.randomUUID(),
      name,
      topic: cleanTopic(req.body.topic),
      private: Boolean(req.body.private),
      createdBy: req.member.id,
      createdAt: new Date().toISOString(),
      members: [req.member.id]
    };
    await collections.channels().insertOne({ ...channel });
    await addChannelMessage(channel, {
      type: "system",
      text: `${req.member.name} created #${name}`
    });
    announceChanged(audienceOf(channel));
    res.status(201).json({ channel: publicChannel(channel, req.member.id) });
  });

  router.post("/:id/join", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    if (channel.private) {
      return res.status(403).json({ error: "Private channels are invite-only." });
    }
    if (isMember(channel, req.member)) {
      return res.json({ channel: publicChannel(channel, req.member.id) });
    }
    const updated = await updateChannel(channel.id, { $addToSet: { members: req.member.id } });
    await addChannelMessage(updated, {
      type: "system",
      text: `${req.member.name} joined #${channel.name}`
    });
    announceChanged(audienceOf(updated));
    res.json({ channel: publicChannel(updated, req.member.id) });
  });

  router.post("/:id/leave", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    if (!isMember(channel, req.member)) {
      return res.status(400).json({ error: "You're not in this channel." });
    }
    const audienceBefore = audienceOf(channel);
    const updated = await updateChannel(channel.id, { $pull: { members: req.member.id } });
    await addChannelMessage(updated, {
      type: "system",
      text: `${req.member.name} left #${channel.name}`
    });
    // Tell everyone who could see it before, including the person leaving
    announceChanged(audienceBefore);
    res.json({ channel: publicChannel(updated, req.member.id) });
  });

  // Channel members can add teammates (the only way into a private channel)
  router.post("/:id/members", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    if (!isMember(channel, req.member)) {
      return res.status(403).json({ error: "Join the channel to add people." });
    }
    const member = await collections
      .members()
      .findOne({ id: req.body.memberId, status: "joined" }, NO_MONGO_ID);
    if (!member) return res.status(404).json({ error: "That person isn't in the workspace." });
    if (channel.members.includes(member.id)) {
      return res.status(409).json({ error: `${member.name} is already in #${channel.name}.` });
    }
    const updated = await updateChannel(channel.id, { $addToSet: { members: member.id } });
    await addChannelMessage(updated, {
      type: "system",
      text: `${req.member.name} added ${member.name} to #${channel.name}`
    });
    announceChanged(audienceOf(updated));
    res.json({ channel: publicChannel(updated, req.member.id) });
  });

  router.patch("/:id", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    if (!isMember(channel, req.member)) {
      return res.status(403).json({ error: "Join the channel to change its topic." });
    }
    const topic = cleanTopic(req.body.topic);
    const updated = await updateChannel(channel.id, { $set: { topic } });
    await addChannelMessage(updated, {
      type: "system",
      text: topic
        ? `${req.member.name} set the topic: ${topic}`
        : `${req.member.name} cleared the topic`
    });
    announceChanged(audienceOf(updated));
    res.json({ channel: publicChannel(updated, req.member.id) });
  });

  // The channel's creator or the workspace owner can delete it
  router.delete("/:id", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    if (channel.createdBy !== req.member.id && req.member.role !== "owner") {
      return res
        .status(403)
        .json({ error: "Only the channel's creator or the workspace owner can delete it." });
    }
    await collections.channels().deleteOne({ id: channel.id });
    await collections.messages().deleteMany({ channel: channel.id });
    announceChanged(audienceOf(channel));
    res.json({ deletedId: channel.id });
  });

  // --- Messages ---

  router.get("/:id/messages", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    res.json(await pageMessages(collections.messages(), { channel: channel.id }, req.query.before));
  });

  router.post("/:id/messages", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    if (!isMember(channel, req.member)) {
      return res.status(403).json({ error: `Join #${channel.name} to send messages.` });
    }
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Message must not be empty." });

    const message = await addChannelMessage(channel, {
      type: "user",
      memberId: req.member.id,
      author: req.member.name,
      text: text.slice(0, 4000)
    });

    // @ai works in every channel, using that channel's recent conversation
    if (BOT_MENTION_PATTERN.test(text)) {
      replyAsBot(getAIResponse, {
        channelId: channel.id,
        channelName: channel.name,
        post: (botMessage) => addChannelMessage(channel, botMessage)
      }).catch((error) => console.error("CHANNEL BOT ERROR:", error.message || error));
    }

    res.status(201).json({ message });
  });

  const announceUpdate = (res, channel) => (message) => {
    bus.emit("channel:messageUpdated", {
      channelId: channel.id,
      message,
      audience: audienceOf(channel)
    });
    res.json({ message });
  };

  router.patch("/:id/messages/:messageId", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    const result = await editMessage(
      collections.messages(),
      { channel: channel.id },
      req.params.messageId,
      req.member,
      req.body.text
    );
    respond(res, result, announceUpdate(res, channel));
  });

  // Authors delete their own; the workspace owner can remove any message
  router.delete("/:id/messages/:messageId", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    const result = await deleteMessage(
      collections.messages(),
      { channel: channel.id },
      req.params.messageId,
      req.member,
      req.member.role === "owner"
    );
    respond(res, result, announceUpdate(res, channel));
  });

  router.post("/:id/messages/:messageId/reactions", async (req, res) => {
    const channel = await loadReadable(req, res);
    if (!channel) return;
    if (!isMember(channel, req.member)) {
      return res.status(403).json({ error: `Join #${channel.name} to react.` });
    }
    const result = await toggleReaction(
      collections.messages(),
      { channel: channel.id },
      req.params.messageId,
      req.member,
      req.body.emoji
    );
    respond(res, result, announceUpdate(res, channel));
  });

  return router;
}

module.exports = {
  createChannelsRouter,
  ensureChannels,
  removeFromAllChannels,
  channelAudience,
  GENERAL_ID
};
