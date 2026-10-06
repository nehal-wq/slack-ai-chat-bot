const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Direct (1:1) messages between #general members.
// Persisted separately from the team channel in data/direct.json.

const DATA_FILE = path.join(__dirname, "data", "direct.json");
const MAX_STORED_MESSAGES = 5000;
const MESSAGES_PER_FETCH = 200;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { messages: [], lastRead: {} };
  }
}

const state = loadState();

function saveState() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

// Same key no matter who is "a" and who is "b"
function conversationKey(a, b) {
  return [a, b].sort().join(":");
}

function addDirectMessage(a, b, message) {
  const fullMessage = {
    id: crypto.randomUUID(),
    conversation: conversationKey(a, b),
    createdAt: new Date().toISOString(),
    ...message
  };
  state.messages.push(fullMessage);
  if (state.messages.length > MAX_STORED_MESSAGES) {
    state.messages = state.messages.slice(-MAX_STORED_MESSAGES);
  }
  saveState();
  return fullMessage;
}

// Call events shown inside a conversation ("Missed call", "Call ended · 3m")
function addDirectSystemMessage(a, b, text) {
  return addDirectMessage(a, b, { type: "system", text });
}

function createDirectRouter({ findJoinedMember, listJoinedMembers, requireMember }) {
  const router = express.Router();

  // Every DM route needs a signed-in member (sets req.member)
  router.use(requireMember);

  // Resolves the signed-in member and the person they're talking to
  function resolvePair(req, res) {
    const me = req.member;
    const other = findJoinedMember(req.params.otherId);
    if (!other || other.id === me.id) {
      res.status(404).json({ error: "That person isn't in the workspace anymore." });
      return null;
    }
    return { me, other, key: conversationKey(me.id, other.id) };
  }

  router.get("/conversations", (req, res) => {
    const me = req.member;
    const joined = listJoinedMembers();
    const conversations = joined
      .filter((member) => member.id !== me.id)
      .map((member) => {
        const key = conversationKey(me.id, member.id);
        const messages = state.messages.filter((m) => m.conversation === key);
        const lastRead = state.lastRead[key]?.[me.id] || "";
        return {
          member,
          lastMessage: messages[messages.length - 1] || null,
          unread: messages.filter(
            (m) => m.type === "user" && m.memberId !== me.id && m.createdAt > lastRead
          ).length
        };
      });

    res.json({ me: joined.find((m) => m.id === me.id), conversations });
  });

  router.get("/:otherId/messages", (req, res) => {
    const pair = resolvePair(req, res);
    if (!pair) return;
    res.json({
      messages: state.messages
        .filter((m) => m.conversation === pair.key)
        .slice(-MESSAGES_PER_FETCH)
    });
  });

  router.post("/:otherId/messages", (req, res) => {
    const pair = resolvePair(req, res);
    if (!pair) return;

    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ error: "Message must not be empty." });
    }

    const message = addDirectMessage(pair.me.id, pair.other.id, {
      type: "user",
      memberId: pair.me.id,
      author: pair.me.name,
      text: text.slice(0, 4000)
    });
    // Sending implies you've read everything up to your own message
    state.lastRead[pair.key] = { ...state.lastRead[pair.key], [pair.me.id]: message.createdAt };
    saveState();

    res.status(201).json({ message });
  });

  router.post("/:otherId/read", (req, res) => {
    const pair = resolvePair(req, res);
    if (!pair) return;
    state.lastRead[pair.key] = {
      ...state.lastRead[pair.key],
      [pair.me.id]: new Date().toISOString()
    };
    saveState();
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createDirectRouter, addDirectSystemMessage, conversationKey };
