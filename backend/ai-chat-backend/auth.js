const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { mailer, sendMail } = require("./mailer");

// Passwordless sign-in: a one-time link is emailed, and clicking it creates a
// session. Only SHA-256 hashes of tokens are stored, never the tokens.

const DATA_FILE = path.join(__dirname, "data", "auth.json");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 30 * 1000;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { loginTokens: {}, sessions: {} };
  }
}

const state = loadState();
const lastRequestAt = new Map(); // email -> timestamp, to stop link spamming

function saveState() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function hash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function pruneExpired() {
  const now = Date.now();
  for (const store of [state.loginTokens, state.sessions]) {
    for (const [key, entry] of Object.entries(store)) {
      if (entry.expiresAt < now) delete store[key];
    }
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function createAuth({
  findJoinedMember,
  findMemberByEmail,
  activateMember,
  createOwner,
  hasOwner,
  publicMember
}) {
  function createSession(memberId) {
    pruneExpired();
    const token = newToken();
    state.sessions[hash(token)] = {
      memberId,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    saveState();
    return token;
  }

  // Signed-in member for a session token, or null (expired, removed, unknown)
  function memberFromToken(token) {
    if (!token) return null;
    const session = state.sessions[hash(token)];
    if (!session || session.expiresAt < Date.now()) return null;
    return findJoinedMember(session.memberId);
  }

  // Express middleware: rejects requests without a valid session
  function requireMember(req, res, next) {
    const member = memberFromToken(bearerToken(req));
    if (!member) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    req.member = member;
    next();
  }

  async function sendLoginLink(email, link, isNew) {
    if (!mailer) {
      // Local development without SMTP: the link only goes to the server log
      console.log(`Sign-in link for ${email} (email not configured): ${link}`);
      return false;
    }
    await sendMail({
      to: email,
      subject: isNew ? "Create your Slack AI Workspace" : "Your Slack AI Workspace sign-in link",
      text: `Use this link to sign in to Slack AI Workspace. It expires in 15 minutes and works once.\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
      html: `
        <p>Use the button below to sign in to <strong>Slack AI Workspace</strong>. It expires in 15 minutes and works once.</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#007A5A;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Sign in</a></p>
        <p style="color:#616061;font-size:13px">If you didn't ask for this, you can ignore this email. Link: ${escapeHtml(link)}</p>
      `
    });
    return true;
  }

  const router = express.Router();

  // Step 1: email me a sign-in link
  router.post("/request", async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    const member = findMemberByEmail(email);
    const isNewWorkspace = !member && !hasOwner();
    if (!member && !isNewWorkspace) {
      return res.status(403).json({
        error: "This workspace is invite-only. Ask a member to invite you, then use the link in your invite email."
      });
    }

    const last = lastRequestAt.get(email) || 0;
    if (Date.now() - last < REQUEST_COOLDOWN_MS) {
      return res.status(429).json({ error: "A link was just sent. Check your inbox, or try again in 30 seconds." });
    }
    lastRequestAt.set(email, Date.now());

    pruneExpired();
    const token = newToken();
    state.loginTokens[hash(token)] = {
      email,
      name: typeof req.body.name === "string" ? req.body.name.trim().slice(0, 60) : "",
      expiresAt: Date.now() + LOGIN_LINK_TTL_MS
    };
    saveState();

    try {
      const emailed = await sendLoginLink(email, `${FRONTEND_URL}/?login=${token}`, isNewWorkspace);
      res.json({ emailed, email });
    } catch (error) {
      console.error("LOGIN EMAIL ERROR:", error.message || error);
      res.status(502).json({ error: "We couldn't send the sign-in email. Please try again." });
    }
  });

  // Step 2: the link was clicked; exchange it for a session
  router.post("/verify", (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const key = hash(token);
    const entry = state.loginTokens[key];
    if (!entry || entry.expiresAt < Date.now()) {
      return res.status(400).json({ error: "This sign-in link is invalid or has expired. Request a new one." });
    }
    delete state.loginTokens[key]; // single use
    saveState();

    let member = findMemberByEmail(entry.email);
    if (member && member.status === "invited") {
      member = activateMember(member, entry.name);
    } else if (!member) {
      if (hasOwner()) {
        return res.status(403).json({ error: "This workspace is invite-only." });
      }
      member = createOwner(entry.email, entry.name);
    }

    res.json({ member: publicMember(member), sessionToken: createSession(member.id) });
  });

  router.get("/me", requireMember, (req, res) => {
    res.json({ member: publicMember(req.member) });
  });

  router.post("/logout", (req, res) => {
    const token = bearerToken(req);
    if (token) {
      delete state.sessions[hash(token)];
      saveState();
    }
    res.json({ ok: true });
  });

  return { router, requireMember, createSession, memberFromToken };
}

module.exports = { createAuth };
