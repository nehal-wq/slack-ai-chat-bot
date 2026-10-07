import { useState, useEffect, useRef } from "react";
import { Avatar, Button, Alert, Spin, Tooltip } from "antd";
import {
  UserAddOutlined,
  TeamOutlined,
  RobotOutlined,
  AudioOutlined,
  VideoCameraOutlined,
  CustomerServiceOutlined
} from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import {
  fetchGeneral,
  fetchOlderGeneral,
  postGeneralMessage,
  editGeneralMessage,
  deleteGeneralMessage,
  reactGeneralMessage
} from "../features/general/generalSlice";
import MessageItem from "./messages/MessageItem";
import Composer from "./messages/Composer";
import MemberAvatar from "./general/MemberAvatar";
import { notifyTyping, useTypingNames, typingLabel } from "../features/realtime/useTyping";
import formatMessageTime from "./general/formatMessageTime";
import InviteModal from "./general/InviteModal";
import MembersDrawer from "./general/MembersDrawer";
import JoinPanel from "./general/JoinPanel";

// New messages are pushed instantly; this slow poll is only a safety net
const POLL_INTERVAL_MS = 30000;
const BOT_MENTION_PATTERN = /@(ai|slack ai)\b/i;

function isAwaitingBot(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === "bot") return false;
    if (messages[i].type === "user" && BOT_MENTION_PATTERN.test(messages[i].text)) {
      return true;
    }
  }
  return false;
}

function SystemNotice({ message }) {
  return (
    <div
      style={{
        textAlign: "center",
        fontSize: "12px",
        color: "var(--text-tertiary)",
        margin: "10px 0"
      }}
    >
      {message.text} · {formatMessageTime(message.createdAt)}
    </div>
  );
}

// Extra @mentions offered in #general besides people
const GENERAL_MENTIONS = [
  { value: "ai", description: "ask the AI bot" },
  { value: "channel", description: "notify everyone in #general" }
];

function GeneralChannel({ inviteToken, onInviteHandled, huddle }) {
  const dispatch = useDispatch();
  const {
    members,
    messages,
    loaded,
    error,
    emailEnabled,
    currentMemberId,
    hasSession,
    authChecked,
    sessionExpired,
    settings
  } = useSelector((state) => state.general);

  const [actionError, setActionError] = useState(null);
  const { hasMore, loadingOlder } = useSelector((state) => state.general);
  const feedRef = useRef(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const messagesEndRef = useRef(null);

  const currentMember = members.find(
    (m) => m.id === currentMemberId && m.status === "joined"
  );
  const joinedMembers = members.filter((m) => m.status === "joined");
  const pendingCount = members.length - joinedMembers.length;
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const mentionNames = joinedMembers.map((m) => m.name);
  const nameOf = (id) => membersById[id]?.name || "Someone";
  const lastMessageId = messages[messages.length - 1]?.id;
  const botTyping = isAwaitingBot(messages);
  const typingText = typingLabel(useTypingNames("general"));

  // Inviting is owner-only unless the owner allows members to invite
  const canInvite =
    Boolean(currentMember) &&
    (currentMember.role === "owner" || settings.membersCanInvite);
  let inviteHint = "";
  if (!currentMember) inviteHint = "Sign in to invite people";
  else if (!canInvite) inviteHint = "Only the workspace owner can invite people";

  const huddleActive = Boolean(huddle.huddle);
  const canHuddle = Boolean(currentMember) && huddle.connected && !huddle.inCall;
  let huddleButtonHint = "";
  if (!currentMember) huddleButtonHint = "Sign in to start a huddle";
  else if (huddle.inCall) huddleButtonHint = "You're in the huddle";
  else if (!huddle.connected) huddleButtonHint = "Connecting to the call server…";

  // Poll so messages from teammates (and bot replies) show up.
  // The channel is members-only, so nothing loads until you're signed in.
  useEffect(() => {
    if (!currentMemberId) return undefined;
    dispatch(fetchGeneral());
    const timer = setInterval(() => dispatch(fetchGeneral()), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [dispatch, currentMemberId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId, botTyping]);

  // Runs a message action and shows any error above the composer
  async function run(action) {
    setActionError(null);
    try {
      await dispatch(action).unwrap();
    } catch (err) {
      setActionError(err);
      throw err;
    }
  }

  // Prepends older history without making the view jump
  async function loadOlder() {
    const feed = feedRef.current;
    const previousHeight = feed?.scrollHeight || 0;
    await run(fetchOlderGeneral(messages[0].createdAt)).catch(() => {});
    requestAnimationFrame(() => {
      if (feed) feed.scrollTop += feed.scrollHeight - previousHeight;
    });
  }

  // A signed-in member must not be asked to sign in while their session is
  // being checked, the channel is loading, or the backend is restarting
  const restoringSession =
    hasSession &&
    !currentMember &&
    (!authChecked || !loaded || (Boolean(error) && members.length === 0));
  const signedOut = !hasSession && !currentMember;
  const showJoinPanel =
    Boolean(inviteToken) || (!currentMember && !restoringSession);

  return (
    <>
      {/* Channel toolbar: members + invite */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "12px",
          flexWrap: "wrap"
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}
          onClick={() => setMembersOpen(true)}
        >
          <Avatar.Group max={{ count: 5 }} size={28}>
            {joinedMembers.map((member) => (
              <Tooltip key={member.id} title={member.name}>
                <span>
                  <MemberAvatar member={member} size={28} />
                </span>
              </Tooltip>
            ))}
          </Avatar.Group>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            {joinedMembers.length} {joinedMembers.length === 1 ? "member" : "members"}
            {pendingCount > 0 && ` · ${pendingCount} pending`}
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Tooltip title={huddleButtonHint}>
            <Button
              icon={<AudioOutlined />}
              onClick={() => huddle.join(false)}
              disabled={!canHuddle}
              loading={huddle.joining}
            >
              {huddleActive ? "Join huddle" : "Huddle"}
            </Button>
          </Tooltip>
          <Tooltip title={huddleButtonHint || (huddleActive ? "Join with video" : "Start a video huddle")}>
            <Button
              icon={<VideoCameraOutlined />}
              onClick={() => huddle.join(true)}
              disabled={!canHuddle}
              aria-label={huddleActive ? "Join with video" : "Start a video huddle"}
            />
          </Tooltip>
          <Button icon={<TeamOutlined />} onClick={() => setMembersOpen(true)}>
            Members
          </Button>
          <Tooltip title={inviteHint}>
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => setInviteOpen(true)}
              disabled={!canInvite}
              style={canInvite ? { background: "#007A5A", borderColor: "#007A5A" } : undefined}
            >
              Invite people
            </Button>
          </Tooltip>
        </div>
      </div>

      {error && (
        <Alert type="error" showIcon title={error} style={{ marginBottom: "12px" }} />
      )}

      {huddleActive && !huddle.inCall && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            padding: "10px 14px",
            marginBottom: "12px",
            borderRadius: "8px",
            background: "var(--success-subtle)",
            border: "1px solid var(--success-border)"
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text)" }}>
            <CustomerServiceOutlined style={{ color: "var(--brand-text)" }} />
            <strong>Huddle in progress</strong>
            <span style={{ color: "var(--text-secondary)" }}>
              with {huddle.huddle.participants.map((p) => p.name).join(", ")}
            </span>
          </span>
          {currentMember && (
            <span style={{ display: "flex", gap: "8px" }}>
              <Button
                type="primary"
                size="small"
                icon={<AudioOutlined />}
                onClick={() => huddle.join(false)}
                style={{ background: "#007A5A", borderColor: "#007A5A" }}
              >
                Join
              </Button>
              <Button size="small" icon={<VideoCameraOutlined />} onClick={() => huddle.join(true)}>
                With video
              </Button>
            </span>
          )}
        </div>
      )}

      {/* Message feed */}
      <div ref={feedRef} style={{ flex: 1, overflowY: "auto", paddingRight: "8px", paddingTop: "14px" }}>
        {loaded && hasMore && messages.length > 0 && (
          <div style={{ textAlign: "center", margin: "4px 0 12px" }}>
            <Button size="small" loading={loadingOlder} onClick={loadOlder}>
              Load older messages
            </Button>
          </div>
        )}

        {signedOut && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "28px",
              margin: "20px auto",
              maxWidth: "560px",
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)" }}>
              #general is for workspace members
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "6px" }}>
              Sign in with your email below to see the conversation. You'll get a one-time
              sign-in link, so there's no password to remember.
            </div>
          </div>
        )}

        {!signedOut && !loaded && (
          <div style={{ textAlign: "center", marginTop: "40px" }}>
            <Spin />
          </div>
        )}

        {loaded && messages.length === 0 && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "28px",
              margin: "20px auto",
              maxWidth: "560px",
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)" }}>
              This is the very beginning of #general
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "6px" }}>
              Invite your teammates by email and start the conversation. Mention{" "}
              <strong>@ai</strong> in a message to bring the AI bot in.
            </div>
          </div>
        )}

        {messages.map((message) => {
          if (message.type === "system") return <SystemNotice key={message.id} message={message} />;
          const isBot = message.type === "bot";
          const isYou = Boolean(currentMember) && message.memberId === currentMember.id;
          const isOwner = currentMember?.role === "owner";
          // Fall back to the stored author name if the member has since left
          const author = membersById[message.memberId] || {
            id: message.memberId || message.author,
            name: message.author
          };
          return (
            <MessageItem
              key={message.id}
              message={message}
              author={author}
              isBot={isBot}
              isYou={isYou}
              canEdit={isYou && !isBot}
              canDelete={isYou || isOwner}
              myId={currentMemberId}
              myName={currentMember?.name}
              mentionNames={mentionNames}
              nameOf={nameOf}
              onEdit={(text) => run(editGeneralMessage({ id: message.id, text }))}
              onDelete={() => run(deleteGeneralMessage(message.id)).catch(() => {})}
              onReact={(emoji) => run(reactGeneralMessage({ id: message.id, emoji })).catch(() => {})}
            />
          );
        })}

        {botTyping && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 16px",
              color: "var(--text-secondary)",
              fontSize: "13px"
            }}
          >
            <RobotOutlined /> Slack AI is typing… <Spin size="small" />
          </div>
        )}

        {typingText && (
          <div
            aria-live="polite"
            style={{ padding: "4px 16px", fontSize: "12px", color: "var(--text-tertiary)", fontStyle: "italic" }}
          >
            {typingText}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer, or join / accept-invite panel */}
      {restoringSession && !inviteToken && (
        <div
          style={{
            marginTop: "16px",
            padding: "16px",
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "10px",
            color: "var(--text-secondary)",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "10px"
          }}
        >
          <Spin size="small" />
          {error
            ? "Can't reach the server right now. You're still a member, reconnecting…"
            : "Signing you back in…"}
        </div>
      )}

      {showJoinPanel ? (
        <JoinPanel
          key={inviteToken || "join"}
          inviteToken={inviteToken}
          currentMember={currentMember}
          sessionExpired={sessionExpired}
          onInviteHandled={onInviteHandled}
        />
      ) : !restoringSession && (
        <>
          {actionError && (
            <Alert
              type="error"
              showIcon
              title={actionError}
              closable
              onClose={() => setActionError(null)}
              style={{ marginTop: "12px" }}
            />
          )}
          <Composer
            placeholder={`Message #general as ${currentMember.name} — @mention people, or @ai to ask the bot`}
            people={joinedMembers.filter((m) => m.id !== currentMemberId)}
            extraMentions={GENERAL_MENTIONS}
            onTyping={() => notifyTyping("general")}
            onSend={(text) => run(postGeneralMessage({ text }))}
          />
        </>
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        emailEnabled={emailEnabled}
      />

      <MembersDrawer
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        members={members}
        currentMember={currentMember}
        canInvite={canInvite}
        onInvite={() => {
          setMembersOpen(false);
          setInviteOpen(true);
        }}
      />
    </>
  );
}

export default GeneralChannel;
