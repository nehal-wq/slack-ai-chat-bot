const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { mailer, sendMail } = require("./mailer");

// #general team channel: members, email invites and messages.
// State is persisted to a JSON file so it survives backend restarts.

const DATA_FILE = path.join(__dirname, "data", "general.json");
const MAX_STORED_MESSAGES = 500;
const MESSAGES_PER_FETCH = 200;
const AI_CONTEXT_LENGTH = 15;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOT_MENTION_PATTERN = /@(ai|slack ai)\b/i;
const BOT_NAME = "Slack AI";

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { members: [], messages: [] };
  }
}

const state = loadState();

function saveState() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function newId() {
  return crypto.randomUUID();
}

// Never expose invite tokens through the shared state endpoint
function publicMember({ inviteToken, ...member }) {
  return member;
}

function findMember(id) {
  return state.members.find((m) => m.id === id);
}

function findJoinedMember(id) {
  const member = findMember(id);
  return member && member.status === "joined" ? member : null;
}

// Workspace roles: the member who created the workspace is its owner and is
// the only one who can remove people. Everyone invited is a member.
const ROLE_OWNER = "owner";
const ROLE_MEMBER = "member";

function findOwner() {
  return state.members.find((m) => m.status === "joined" && m.role === ROLE_OWNER);
}

// Data saved before roles existed: the earliest joined member becomes owner
function ensureRoles() {
  let changed = false;
  for (const member of state.members) {
    if (!member.role) {
      member.role = ROLE_MEMBER;
      changed = true;
    }
  }
  if (!findOwner()) {
    const [creator] = state.members
      .filter((m) => m.status === "joined")
      .sort((a, b) => (a.joinedAt || "").localeCompare(b.joinedAt || ""));
    if (creator) {
      creator.role = ROLE_OWNER;
      changed = true;
    }
  }
  if (changed) saveState();
}

ensureRoles();

// Workspace settings, with defaults for anything not saved yet.
// Inviting is owner-only unless the owner allows members to invite.
const DEFAULT_SETTINGS = { membersCanInvite: false };

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...state.settings };
}

// Returns why requester may not remove member, or null if allowed
function removalError(requester, member) {
  const isOwner = requester.role === ROLE_OWNER;
  if (member.role === ROLE_OWNER) {
    return member.id === requester.id
      ? "Transfer ownership to someone else before leaving."
      : "The workspace owner can't be removed.";
  }
  if (isOwner || member.id === requester.id) return null;
  if (member.status === "invited" && member.invitedBy === requester.id) return null;
  return "Only the workspace owner can remove members or other people's invites.";
}

function listJoinedMembers() {
  return state.members.filter((m) => m.status === "joined").map(publicMember);
}

function addMessage(message) {
  const fullMessage = {
    id: newId(),
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

function addSystemMessage(text) {
  return addMessage({ type: "system", text });
}

function cleanName(name, email) {
  const trimmed = typeof name === "string" ? name.trim().slice(0, 60) : "";
  return trimmed || email.split("@")[0];
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function sendInviteEmail({ to, inviterName, link }) {
  if (!mailer) {
    return {
      emailSent: false,
      emailError: "Email is not configured on the server (see SMTP_* in the backend .env)."
    };
  }

  try {
    await sendMail({
      to,
      subject: `${inviterName} invited you to #general on Slack AI Workspace`,
      text: `${inviterName} invited you to join the #general channel.\n\nAccept the invite: ${link}\n`,
      html: `
        <p><strong>${escapeHtml(inviterName)}</strong> invited you to join the <strong>#general</strong> channel on Slack AI Workspace.</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#007A5A;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Join #general</a></p>
        <p style="color:#616061;font-size:13px">Or paste this link into your browser: ${link}</p>
      `
    });
    return { emailSent: true };
  } catch (error) {
    console.error("INVITE EMAIL ERROR:", error.message || error);
    return { emailSent: false, emailError: "The invite email could not be sent." };
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function replyAsBot(getAIResponse) {
  const recent = state.messages
    .filter((m) => m.type !== "system")
    .slice(-AI_CONTEXT_LENGTH)
    .map((m) =>
      m.type === "bot"
        ? { role: "assistant", content: m.text }
        : { role: "user", content: `${m.author}: ${m.text}` }
    );

  let text;
  try {
    const reply = await getAIResponse([
      {
        role: "system",
        content:
          "You are Slack AI, an assistant in the #general channel of a team workspace. Several teammates talk here; each user message is prefixed with the sender's name. Reply to whoever mentioned you, concisely and in a friendly tone."
      },
      ...recent
    ]);
    text = reply.trim();
  } catch (error) {
    console.error("GENERAL BOT ERROR:", error.message || error);
    text = "Sorry, I couldn't come up with a reply right now. Please try again!";
  }

  addMessage({ type: "bot", author: BOT_NAME, text });
}

function findMemberByEmail(email) {
  return state.members.find((m) => m.email === normalizeEmail(email));
}

function hasOwner() {
  return Boolean(findOwner());
}

// An invited person proved they own the email (invite or sign-in link)
function activateMember(member, name) {
  member.status = "joined";
  member.name = cleanName(name || member.name, member.email);
  member.joinedAt = new Date().toISOString();
  delete member.inviteToken;
  addSystemMessage(`${member.name} joined #general`);
  return member;
}

// The very first person to sign in creates the workspace and owns it
function createOwner(email, name) {
  const member = {
    id: newId(),
    name: cleanName(name, email),
    email: normalizeEmail(email),
    status: "joined",
    role: ROLE_OWNER,
    createdAt: new Date().toISOString(),
    joinedAt: new Date().toISOString()
  };
  state.members.push(member);
  addSystemMessage(`${member.name} created the workspace and joined #general`);
  return member;
}

// Every route except invite lookup/accept requires a signed-in member
// (requireMember sets req.member from the session token).
function createGeneralRouter({ getAIResponse, requireMember, createSession }) {
  const router = express.Router();

  router.get("/state", requireMember, (req, res) => {
    res.json({
      members: state.members.map(publicMember),
      messages: state.messages.slice(-MESSAGES_PER_FETCH),
      emailEnabled: Boolean(mailer),
      settings: getSettings()
    });
  });

  // Workspace settings; only the owner can change them
  router.patch("/settings", requireMember, (req, res) => {
    if (req.member.role !== ROLE_OWNER) {
      return res.status(403).json({ error: "Only the workspace owner can change settings." });
    }
    if (typeof req.body.membersCanInvite !== "boolean") {
      return res.status(400).json({ error: "membersCanInvite must be true or false." });
    }

    const settings = getSettings();
    if (settings.membersCanInvite !== req.body.membersCanInvite) {
      state.settings = { ...settings, membersCanInvite: req.body.membersCanInvite };
      addSystemMessage(
        req.body.membersCanInvite
          ? `${req.member.name} allowed members to invite people`
          : `${req.member.name} limited inviting people to the workspace owner`
      );
    }
    res.json({ settings: getSettings() });
  });

  router.post("/invites", requireMember, async (req, res) => {
    const inviter = req.member;
    if (inviter.role !== ROLE_OWNER && !getSettings().membersCanInvite) {
      return res.status(403).json({
        error: "Only the workspace owner can invite people. Ask the owner to invite them, or to allow members to invite."
      });
    }

    const email = normalizeEmail(req.body.email);
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    let member = state.members.find((m) => m.email === email);
    if (member && member.status === "joined") {
      return res.status(409).json({ error: `${member.name} is already in #general.` });
    }

    const resend = Boolean(member);
    if (!member) {
      member = {
        id: newId(),
        email,
        status: "invited",
        role: ROLE_MEMBER,
        createdAt: new Date().toISOString()
      };
      state.members.push(member);
    }
    member.name = cleanName(req.body.name || member.name, email);
    member.invitedBy = inviter.id;
    member.invitedAt = new Date().toISOString();
    member.inviteToken = crypto.randomBytes(24).toString("hex");

    if (!resend) {
      addSystemMessage(`${inviter.name} invited ${email} to #general`);
    } else {
      saveState();
    }

    const inviteLink = `${FRONTEND_URL}/?invite=${member.inviteToken}`;
    const emailResult = await sendInviteEmail({
      to: email,
      inviterName: inviter.name,
      link: inviteLink
    });

    res.status(201).json({
      member: publicMember(member),
      inviteLink,
      resent: resend,
      ...emailResult
    });
  });

  router.get("/invites/:token", (req, res) => {
    const member = state.members.find(
      (m) => m.status === "invited" && m.inviteToken === req.params.token
    );
    if (!member) {
      return res.status(404).json({ error: "This invite link is invalid or has already been used." });
    }

    res.json({
      email: member.email,
      name: member.name,
      invitedByName: findMember(member.invitedBy)?.name || "A teammate"
    });
  });

  router.post("/invites/:token/accept", (req, res) => {
    const member = state.members.find(
      (m) => m.status === "invited" && m.inviteToken === req.params.token
    );
    if (!member) {
      return res.status(404).json({ error: "This invite link is invalid or has already been used." });
    }

    activateMember(member, req.body.name);
    res.json({ member: publicMember(member), sessionToken: createSession(member.id) });
  });

  // Remove a member, or revoke a pending invite
  router.delete("/members/:id", requireMember, (req, res) => {
    const requester = req.member;

    const member = findMember(req.params.id);
    if (!member) {
      return res.status(404).json({ error: "Member not found." });
    }

    const permissionError = removalError(requester, member);
    if (permissionError) {
      return res.status(403).json({ error: permissionError });
    }

    state.members = state.members.filter((m) => m.id !== member.id);

    if (member.status === "invited") {
      addSystemMessage(`${requester.name} revoked the invite for ${member.email}`);
    } else if (member.id === requester.id) {
      addSystemMessage(`${member.name} left #general`);
    } else {
      addSystemMessage(`${requester.name} removed ${member.name} from #general`);
    }

    res.json({ removedId: member.id });
  });

  // Owner hands the workspace over to another joined member
  router.post("/members/:id/make-owner", requireMember, (req, res) => {
    const requester = req.member;
    if (requester.role !== ROLE_OWNER) {
      return res.status(403).json({ error: "Only the workspace owner can transfer ownership." });
    }

    const member = findJoinedMember(req.params.id);
    if (!member || member.id === requester.id) {
      return res.status(404).json({ error: "Choose another member of the workspace." });
    }

    requester.role = ROLE_MEMBER;
    member.role = ROLE_OWNER;
    addSystemMessage(`${requester.name} made ${member.name} the workspace owner`);
    res.json({ members: state.members.map(publicMember) });
  });

  router.post("/messages", requireMember, (req, res) => {
    const member = req.member;

    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ error: "Message must not be empty." });
    }

    const message = addMessage({
      type: "user",
      memberId: member.id,
      author: member.name,
      text: text.slice(0, 4000)
    });

    // Bot replies asynchronously; clients pick it up on their next poll
    if (BOT_MENTION_PATTERN.test(text)) {
      replyAsBot(getAIResponse);
    }

    res.status(201).json({ message });
  });

  return router;
}

module.exports = {
  createGeneralRouter,
  findJoinedMember,
  listJoinedMembers,
  addSystemMessage,
  findMemberByEmail,
  activateMember,
  createOwner,
  hasOwner,
  publicMember
};
