require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { App: SlackApp } = require("@slack/bolt");
const {
  createGeneralRouter,
  findJoinedMember,
  listJoinedMembers,
  addSystemMessage,
  findMemberByEmail,
  activateMember,
  createOwner,
  hasOwner,
  publicMember
} = require("./general");
const { createAuth } = require("./auth");
const { createDirectRouter, addDirectSystemMessage } = require("./direct");
const { attachHuddleServer } = require("./huddle");
const { verifyMailer } = require("./mailer");
const { connectDb } = require("./db");
const config = require("./config");
const fs = require("fs");
const path = require("path");

// Validate environment variables
const requiredEnvVars = [
  "OPENROUTER_API_KEY",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_APP_TOKEN"
];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.warn("⚠️ Warning: Missing environment variables:", missingVars.join(", "));
}

const app = express();
const PORT = config.PORT;
const AI_MODEL = process.env.AI_MODEL || "openrouter/free";

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY
});

const slackApp = new SlackApp({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// --- Security ---
app.set("trust proxy", config.TRUST_PROXY);
app.use(helmet());
// Only our own frontend may call the API from a browser
app.use(
  cors({
    origin: (origin, callback) => callback(null, config.isAllowedOrigin(origin))
  })
);
app.use(express.json({ limit: "100kb" }));

const limit = (windowMinutes, max, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message }
  });
// Generous overall cap (pages poll every few seconds; offices share one IP)
app.use("/api", limit(5, 2000, "Too many requests. Please slow down."));
// Tight caps on endpoints that send email or spend AI credit
app.use("/api/auth/request", limit(15, 10, "Too many sign-in requests. Try again later."));
app.use("/api/chat", limit(1, 30, "Too many AI requests. Wait a minute and try again."));

// Passwordless sign-in (emailed one-time links) and sessions
const auth = createAuth({
  findJoinedMember,
  findMemberByEmail,
  activateMember,
  createOwner,
  hasOwner,
  publicMember
});
app.use("/api/auth", auth.router);

// In-memory conversation history per Slack channel
const MAX_HISTORY_LENGTH = 15;
const slackHistory = new Map();

async function getAIResponse(messages) {
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: messages
  });

  const reply = response.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error("AI returned an empty response");
  }

  return reply;
}

// Health check endpoint
app.get("/api", (req, res) => {
  res.json({
    status: "ok",
    message: "AI Chat Backend is working!",
    model: AI_MODEL
  });
});

// Web chat endpoint (signed-in members only: it spends OpenRouter credit)
app.post("/api/chat", auth.requireMember, async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({
        error: "Message is required and must not be empty"
      });
    }

    // Keep only last N messages from frontend history to prevent token overflow
    const trimmedHistory = Array.isArray(history)
      ? history.slice(-MAX_HISTORY_LENGTH)
      : [];

    const messages = [
      {
        role: "system",
        content: "You are a helpful AI assistant inside a Slack-style chat application."
      },
      ...trimmedHistory,
      {
        role: "user",
        content: message.trim()
      }
    ];

    const reply = await getAIResponse(messages);
    res.json({ reply });
  } catch (error) {
    console.error("Chat API Error:", error.message || error);
    const errorMessage =
      error?.error?.message ||
      error.message ||
      "An unexpected error occurred while processing your request.";
    res.status(error.status || 500).json({ error: errorMessage });
  }
});

// STUN/TURN servers for calls (TURN credentials stay out of the frontend build)
app.get("/api/calls/ice-servers", auth.requireMember, (req, res) => {
  res.json({ iceServers: config.iceServers() });
});

// #general team channel (members, email invites, messages)
app.use(
  "/api/general",
  createGeneralRouter({
    getAIResponse,
    requireMember: auth.requireMember,
    createSession: auth.createSession
  })
);

// Direct (1:1) messages between members
app.use(
  "/api/dm",
  createDirectRouter({
    findJoinedMember,
    listJoinedMembers,
    requireMember: auth.requireMember
  })
);

// Unknown API routes and unexpected errors return JSON, never a stack trace
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// In production the backend also serves the built frontend, so the whole app
// lives on one HTTPS address (no cross-site requests, same-origin WebSockets)
if (fs.existsSync(path.join(config.FRONTEND_DIST, "index.html"))) {
  app.use(express.static(config.FRONTEND_DIST, { index: false }));
  // Any other page path is a frontend route (e.g. /?invite=… or /?login=…)
  app.get(/^\/(?!api\/|ws\/).*/, (req, res) => {
    res.sendFile(path.join(config.FRONTEND_DIST, "index.html"));
  });
  console.log(`Serving frontend from ${config.FRONTEND_DIST}`);
}
// eslint-disable-next-line no-unused-vars -- Express needs all four arguments
app.use((error, req, res, next) => {
  console.error("API ERROR:", error.message || error);
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});

// Slack Bot App Mention Handler
slackApp.event("app_mention", async ({ event, say }) => {
  try {
    // Avoid bot reply loops
    if (event.bot_id) return;

    const channelId = event.channel;
    const cleanMessage = (event.text || "").replace(/<@[^>]+>/g, "").trim();

    console.log("SLACK MESSAGE RECEIVED:", event.text);
    console.log("CLEAN MESSAGE:", cleanMessage);

    if (!cleanMessage) {
      await say("Hi! 👋 How can I help you today? Ask me any question!");
      return;
    }

    let history = slackHistory.get(channelId) || [];

    const messages = [
      {
        role: "system",
        content:
          "You are a helpful AI assistant inside a Slack workspace. Remember and use the previous conversation when answering follow-up questions."
      },
      ...history,
      {
        role: "user",
        content: cleanMessage
      }
    ];

    const reply = await getAIResponse(messages);

    // Update history only on success and apply sliding window limit
    history.push(
      { role: "user", content: cleanMessage },
      { role: "assistant", content: reply }
    );
    if (history.length > MAX_HISTORY_LENGTH * 2) {
      history = history.slice(-MAX_HISTORY_LENGTH * 2);
    }
    slackHistory.set(channelId, history);

    // Slack has a 4000 character limit per message; chunk if needed
    if (reply.length > 3900) {
      for (let i = 0; i < reply.length; i += 3900) {
        await say(reply.slice(i, i + 3900));
      }
    } else {
      await say(reply);
    }
  } catch (error) {
    console.error("SLACK ERROR:", error.message || error);
    await say("Sorry, I encountered an issue processing your request right now. Please try again!");
  }
});

// Start: connect to MongoDB first, then accept requests
async function startServer() {
  try {
    await connectDb();
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MONGODB CONNECTION ERROR:", error.message || error);
    console.error("  Check MONGODB_URI in .env and that MongoDB is running.");
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Allowed frontend origins: ${config.allowedOrigins.join(", ")}`);
    verifyMailer();
  });

  // Huddle and direct-call signaling over WebSocket (ws://localhost:PORT/ws/huddle)
  attachHuddleServer(server, {
    findJoinedMember,
    memberFromToken: auth.memberFromToken,
    addSystemMessage,
    addDirectSystemMessage,
    isAllowedOrigin: config.isAllowedOrigin
  });
}

startServer();

// Start Slack Socket Mode Bot
(async () => {
  try {
    await slackApp.start();
    console.log("Slack bot is running!");
  } catch (error) {
    console.error("SLACK START ERROR:", error.message || error);
  }
})();