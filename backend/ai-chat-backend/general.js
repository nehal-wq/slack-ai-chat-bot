const express = require("express");
const crypto = require("crypto");
const { mailer, sendMail } = require("./mailer");
const { collections, NO_MONGO_ID } = require("./db");
const { bus } = require("./events");
const {
  pageMessages,
  editMessage,
  deleteMessage,
  toggleReaction,
  respond
} = require("./messages");

// #general team channel: members, email invites and messages, stored in
// MongoDB (collections: members, messages, settings).

const AI_CONTEXT_LENGTH = 15;
const { FRONTEND_URL } = require("./config");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOT_MENTION_PATTERN = /@(ai|slack ai)\b/i;
const BOT_NAME = "Slack AI";
// #general is stored as the channel "general" (see channels.js)
const GENERAL_SCOPE = { channel: "general" };

// Workspace roles: the member who created the workspace is its owner and is
// the only one who can remove people. Everyone invited is a member.
const ROLE_OWNER = "owner";
const ROLE_MEMBER = "member";

// Workspace settings, with defaults for anything not saved yet.
// Inviting is owner-only unless the owner allows members to invite.
const SETTINGS_ID = "workspace";
const DEFAULT_SETTINGS = { membersCanInvite: false };

function newId() {
  return crypto.randomUUID();
}

// Never expose invite tokens (or Mongo's _id) to clients
function publicMember(member) {
  if (!member) return member;
  const { _id, inviteToken, ...rest } = member;
  return rest;
}

function findMember(id) {
  if (typeof id !== "string") return null;
  return collections.members().findOne({ id }, NO_MONGO_ID);
}

async function findJoinedMember(id) {
  const member = await findMember(id);
  return member && member.status === "joined" ? member : null;
}

function findOwner() {
  return collections.members().findOne({ status: "joined", role: ROLE_OWNER }, NO_MONGO_ID);
}

async function hasOwner() {
  return Boolean(await findOwner());
}

function findMemberByEmail(email) {
  return collections.members().findOne({ email: normalizeEmail(email) }, NO_MONGO_ID);
}

async function listMembers() {
  return collections.members().find({}, NO_MONGO_ID).sort({ createdAt: 1 }).toArray();
}

async function listJoinedMembers() {
  const members = await collections
    .members()
    .find({ status: "joined" }, NO_MONGO_ID)
    .sort({ createdAt: 1 })
    .toArray();
  return members.map(publicMember);
}

function updateMember(id, changes, unset) {
  const update = { $set: changes };
  if (unset) update.$unset = unset;
  return collections.members().findOneAndUpdate({ id }, update, {
    returnDocument: "after",
    ...NO_MONGO_ID
  });
}

async function getSettings() {
  const saved = await collections.settings().findOne({ _id: SETTINGS_ID });
  const { _id, ...settings } = saved || {};
  return { ...DEFAULT_SETTINGS, ...settings };
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

async function addMessage(message) {
  const fullMessage = {
    id: newId(),
    channel: "general",
    createdAt: new Date().toISOString(),
    ...message
  };
  await collections.messages().insertOne({ ...fullMessage });
  // Pushed to every signed-in browser right away
  bus.emit("general:message", fullMessage);
  return fullMessage;
}

// System messages accompany every member/role/settings change, so they also
// tell browsers to refresh the member list
async function addSystemMessage(text) {
  const message = await addMessage({ type: "system", text });
  bus.emit("general:changed");
  return message;
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

async function replyAsBot(
  getAIResponse,
  { channelId = "general", channelName = "general", post = addMessage } = {}
) {
  const latest = await collections
    .messages()
    .find({ channel: channelId, type: { $ne: "system" }, deleted: { $ne: true } }, NO_MONGO_ID)
    .sort({ createdAt: -1 })
    .limit(AI_CONTEXT_LENGTH)
    .toArray();
  const recent = latest
    .reverse()
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
          `You are Slack AI, an assistant in the #${channelName} channel of a team workspace. Several teammates talk here; each user message is prefixed with the sender's name. Reply to whoever mentioned you, concisely and in a friendly tone.`
      },
      ...recent
    ]);
    text = reply.trim();
  } catch (error) {
    console.error("GENERAL BOT ERROR:", error.message || error);
    text = "Sorry, I couldn't come up with a reply right now. Please try again!";
  }

  await post({ type: "bot", author: BOT_NAME, text });
}

// An invited person proved they own the email (invite or sign-in link)
async function activateMember(member, name) {
  const activated = await updateMember(
    member.id,
    {
      status: "joined",
      name: cleanName(name || member.name, member.email),
      joinedAt: new Date().toISOString()
    },
    { inviteToken: "" }
  );
  await addSystemMessage(`${activated.name} joined #general`);
  return activated;
}

// The very first person to sign in creates the workspace and owns it
async function createOwner(email, name) {
  const member = {
    id: newId(),
    name: cleanName(name, email),
    email: normalizeEmail(email),
    status: "joined",
    role: ROLE_OWNER,
    createdAt: new Date().toISOString(),
    joinedAt: new Date().toISOString()
  };
  await collections.members().insertOne({ ...member });
  await addSystemMessage(`${member.name} created the workspace and joined #general`);
  return member;
}

// Every route except invite lookup/accept requires a signed-in member
// (requireMember sets req.member from the session token).
function createGeneralRouter({ getAIResponse, requireMember, createSession }) {
  const router = express.Router();

  router.get("/state", requireMember, async (req, res) => {
    const [members, page, settings] = await Promise.all([
      listMembers(),
      pageMessages(collections.messages(), GENERAL_SCOPE),
      getSettings()
    ]);
    res.json({
      members: members.map(publicMember),
      messages: page.messages,
      hasMore: page.hasMore,
      emailEnabled: Boolean(mailer),
      settings
    });
  });

  // Workspace settings; only the owner can change them
  router.patch("/settings", requireMember, async (req, res) => {
    if (req.member.role !== ROLE_OWNER) {
      return res.status(403).json({ error: "Only the workspace owner can change settings." });
    }
    if (typeof req.body.membersCanInvite !== "boolean") {
      return res.status(400).json({ error: "membersCanInvite must be true or false." });
    }

    const settings = await getSettings();
    if (settings.membersCanInvite !== req.body.membersCanInvite) {
      await collections
        .settings()
        .updateOne(
          { _id: SETTINGS_ID },
          { $set: { membersCanInvite: req.body.membersCanInvite } },
          { upsert: true }
        );
      await addSystemMessage(
        req.body.membersCanInvite
          ? `${req.member.name} allowed members to invite people`
          : `${req.member.name} limited inviting people to the workspace owner`
      );
    }
    res.json({ settings: await getSettings() });
  });

  router.post("/invites", requireMember, async (req, res) => {
    const inviter = req.member;
    if (inviter.role !== ROLE_OWNER && !(await getSettings()).membersCanInvite) {
      return res.status(403).json({
        error: "Only the workspace owner can invite people. Ask the owner to invite them, or to allow members to invite."
      });
    }

    const email = normalizeEmail(req.body.email);
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    const existing = await findMemberByEmail(email);
    if (existing && existing.status === "joined") {
      return res.status(409).json({ error: `${existing.name} is already in #general.` });
    }

    const resend = Boolean(existing);
    const invite = {
      name: cleanName(req.body.name || existing?.name, email),
      invitedBy: inviter.id,
      invitedAt: new Date().toISOString(),
      inviteToken: crypto.randomBytes(24).toString("hex")
    };

    let member;
    if (existing) {
      member = await updateMember(existing.id, invite);
      bus.emit("general:changed");
    } else {
      member = {
        id: newId(),
        email,
        status: "invited",
        role: ROLE_MEMBER,
        createdAt: new Date().toISOString(),
        ...invite
      };
      await collections.members().insertOne({ ...member });
      await addSystemMessage(`${inviter.name} invited ${email} to #general`);
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

  function findInvite(token) {
    if (typeof token !== "string" || !token) return null;
    return collections.members().findOne({ status: "invited", inviteToken: token }, NO_MONGO_ID);
  }

  router.get("/invites/:token", async (req, res) => {
    const member = await findInvite(req.params.token);
    if (!member) {
      return res.status(404).json({ error: "This invite link is invalid or has already been used." });
    }

    res.json({
      email: member.email,
      name: member.name,
      invitedByName: (await findMember(member.invitedBy))?.name || "A teammate"
    });
  });

  router.post("/invites/:token/accept", async (req, res) => {
    const member = await findInvite(req.params.token);
    if (!member) {
      return res.status(404).json({ error: "This invite link is invalid or has already been used." });
    }

    const activated = await activateMember(member, req.body.name);
    res.json({ member: publicMember(activated), sessionToken: await createSession(activated.id) });
  });

  // Remove a member, or revoke a pending invite
  router.delete("/members/:id", requireMember, async (req, res) => {
    const requester = req.member;

    const member = await findMember(req.params.id);
    if (!member) {
      return res.status(404).json({ error: "Member not found." });
    }

    const permissionError = removalError(requester, member);
    if (permissionError) {
      return res.status(403).json({ error: permissionError });
    }

    await collections.members().deleteOne({ id: member.id });
    // Removed people are signed out everywhere and leave every channel
    await collections.sessions().deleteMany({ memberId: member.id });
    await collections.channels().updateMany({}, { $pull: { members: member.id } });

    if (member.status === "invited") {
      await addSystemMessage(`${requester.name} revoked the invite for ${member.email}`);
    } else if (member.id === requester.id) {
      await addSystemMessage(`${member.name} left #general`);
    } else {
      await addSystemMessage(`${requester.name} removed ${member.name} from #general`);
    }

    res.json({ removedId: member.id });
  });

  // Owner hands the workspace over to another joined member
  router.post("/members/:id/make-owner", requireMember, async (req, res) => {
    const requester = req.member;
    if (requester.role !== ROLE_OWNER) {
      return res.status(403).json({ error: "Only the workspace owner can transfer ownership." });
    }

    const member = await findJoinedMember(req.params.id);
    if (!member || member.id === requester.id) {
      return res.status(404).json({ error: "Choose another member of the workspace." });
    }

    await updateMember(requester.id, { role: ROLE_MEMBER });
    await updateMember(member.id, { role: ROLE_OWNER });
    await addSystemMessage(`${requester.name} made ${member.name} the workspace owner`);
    res.json({ members: (await listMembers()).map(publicMember) });
  });

  router.post("/messages", requireMember, async (req, res) => {
    const member = req.member;

    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ error: "Message must not be empty." });
    }

    const message = await addMessage({
      type: "user",
      memberId: member.id,
      author: member.name,
      text: text.slice(0, 4000)
    });

    // Bot replies asynchronously; clients pick it up on their next poll
    if (BOT_MENTION_PATTERN.test(text)) {
      replyAsBot(getAIResponse).catch((error) =>
        console.error("GENERAL BOT ERROR:", error.message || error)
      );
    }

    res.status(201).json({ message });
  });

  // Older history: the page of messages before ?before=<createdAt>
  router.get("/messages", requireMember, async (req, res) => {
    res.json(await pageMessages(collections.messages(), GENERAL_SCOPE, req.query.before));
  });

  // Edits, deletes and reactions are pushed to everyone right away
  const announce = (res) => (message) => {
    bus.emit("general:messageUpdated", message);
    res.json({ message });
  };

  router.patch("/messages/:id", requireMember, async (req, res) => {
    const result = await editMessage(
      collections.messages(),
      GENERAL_SCOPE,
      req.params.id,
      req.member,
      req.body.text
    );
    respond(res, result, announce(res));
  });

  // Authors delete their own messages; the owner can remove any message
  router.delete("/messages/:id", requireMember, async (req, res) => {
    const result = await deleteMessage(
      collections.messages(),
      GENERAL_SCOPE,
      req.params.id,
      req.member,
      req.member.role === ROLE_OWNER
    );
    respond(res, result, announce(res));
  });

  router.post("/messages/:id/reactions", requireMember, async (req, res) => {
    const result = await toggleReaction(
      collections.messages(),
      GENERAL_SCOPE,
      req.params.id,
      req.member,
      req.body.emoji
    );
    respond(res, result, announce(res));
  });

  return router;
}

module.exports = {
  createGeneralRouter,
  findJoinedMember,
  listJoinedMembers,
  addSystemMessage,
  replyAsBot,
  findMemberByEmail,
  activateMember,
  createOwner,
  hasOwner,
  publicMember
};
