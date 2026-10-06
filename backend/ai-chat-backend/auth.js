const express = require("express");
const crypto = require("crypto");
const { mailer, sendMail } = require("./mailer");
const { collections } = require("./db");

// Passwordless sign-in: a one-time link is emailed, and clicking it creates a
// session. Only SHA-256 hashes of tokens are stored, never the tokens.
//
// Sessions don't expire: you stay signed in until you sign out or the owner
// removes you. The browser that asked for the link is signed in too, even if
// the link is opened somewhere else (another browser, a phone), by polling.
//
// MongoDB collections: loginTokens (TTL), loginApprovals (TTL), sessions.

const { FRONTEND_URL } = require("./config");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_LINK_TTL_MS = 15 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 30 * 1000;

const lastRequestAt = new Map(); // email -> timestamp, to stop link spamming

function hash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
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
  async function createSession(memberId) {
    const token = newToken();
    await collections.sessions().insertOne({
      _id: hash(token),
      memberId,
      createdAt: new Date()
    });
    return token;
  }

  // Signed-in member for a session token, or null (signed out, removed, unknown)
  async function memberFromToken(token) {
    if (typeof token !== "string" || !token) return null;
    const session = await collections.sessions().findOne({ _id: hash(token) });
    if (!session) return null;
    return findJoinedMember(session.memberId);
  }

  // Express middleware: rejects requests without a valid session
  async function requireMember(req, res, next) {
    const member = await memberFromToken(bearerToken(req));
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

    const member = await findMemberByEmail(email);
    const isNewWorkspace = !member && !(await hasOwner());
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

    const token = newToken();
    const requestId = newToken();
    await collections.loginTokens().insertOne({
      _id: hash(token),
      email,
      name: typeof req.body.name === "string" ? req.body.name.trim().slice(0, 60) : "",
      requestHash: hash(requestId),
      expiresAt: new Date(Date.now() + LOGIN_LINK_TTL_MS)
    });

    try {
      const emailed = await sendLoginLink(email, `${FRONTEND_URL}/?login=${token}`, isNewWorkspace);
      res.json({ emailed, email, requestId });
    } catch (error) {
      console.error("LOGIN EMAIL ERROR:", error.message || error);
      res.status(502).json({ error: "We couldn't send the sign-in email. Please try again." });
    }
  });

  // Step 2: the link was clicked; exchange it for a session
  router.post("/verify", async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    // Atomically claim the link so it can only ever be used once
    const entry = await collections.loginTokens().findOneAndDelete({ _id: hash(token) });
    if (!entry || entry.expiresAt < new Date()) {
      return res.status(400).json({ error: "This sign-in link is invalid or has expired. Request a new one." });
    }

    let member = await findMemberByEmail(entry.email);
    if (member && member.status === "invited") {
      member = await activateMember(member, entry.name);
    } else if (!member) {
      if (await hasOwner()) {
        return res.status(403).json({ error: "This workspace is invite-only." });
      }
      member = await createOwner(entry.email, entry.name);
    }

    if (entry.requestHash) {
      await collections.loginApprovals().updateOne(
        { _id: entry.requestHash },
        { $set: { memberId: member.id, expiresAt: new Date(Date.now() + LOGIN_LINK_TTL_MS) } },
        { upsert: true }
      );
    }

    res.json({ member: publicMember(member), sessionToken: await createSession(member.id) });
  });

  // Step 2b: the requesting browser asks "has my link been clicked yet?"
  router.post("/poll", async (req, res) => {
    const requestId = typeof req.body.requestId === "string" ? req.body.requestId : "";
    // Hand a session over at most once
    const approval = await collections.loginApprovals().findOneAndDelete({ _id: hash(requestId) });
    if (!approval || approval.expiresAt < new Date()) {
      return res.json({ pending: true });
    }
    const member = await findJoinedMember(approval.memberId);
    if (!member) return res.json({ pending: true });
    res.json({ member: publicMember(member), sessionToken: await createSession(member.id) });
  });

  router.get("/me", requireMember, (req, res) => {
    res.json({ member: publicMember(req.member) });
  });

  router.post("/logout", async (req, res) => {
    const token = bearerToken(req);
    if (token) {
      await collections.sessions().deleteOne({ _id: hash(token) });
    }
    res.json({ ok: true });
  });

  return { router, requireMember, createSession, memberFromToken };
}

module.exports = { createAuth };
