import { useState, useEffect, useRef } from "react";
import { Avatar, Button, Input, Tag, Alert, Spin, Tooltip } from "antd";
import {
  SendOutlined,
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
  postGeneralMessage
} from "../features/general/generalSlice";
import MemberAvatar from "./general/MemberAvatar";
import formatMessageTime from "./general/formatMessageTime";
import InviteModal from "./general/InviteModal";
import MembersDrawer from "./general/MembersDrawer";
import JoinPanel from "./general/JoinPanel";

const POLL_INTERVAL_MS = 3000;
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

function MessageRow({ message, member, isYou }) {
  if (message.type === "system") {
    return (
      <div
        style={{
          textAlign: "center",
          fontSize: "12px",
          color: "#868686",
          margin: "10px 0"
        }}
      >
        {message.text} · {formatMessageTime(message.createdAt)}
      </div>
    );
  }

  const isBot = message.type === "bot";
  // Fall back to the stored author name if the member has since left
  const avatarMember = member || { id: message.memberId, name: message.author };

  return (
    <div
      style={{
        padding: "10px 16px",
        marginBottom: "6px",
        borderRadius: "8px",
        background: "#FFFFFF",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        display: "flex",
        alignItems: "flex-start",
        gap: "14px"
      }}
    >
      <MemberAvatar member={avatarMember} bot={isBot} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "2px"
          }}
        >
          <span style={{ fontWeight: 700, color: "#1D1C1D", fontSize: "14px" }}>
            {member?.name || message.author}
          </span>
          {isBot && (
            <Tag
              color="purple"
              style={{ fontSize: "11px", padding: "0 4px", lineHeight: "18px" }}
            >
              APP
            </Tag>
          )}
          {isYou && <Tag color="blue" style={{ fontSize: "11px", lineHeight: "18px" }}>you</Tag>}
          <span style={{ fontSize: "12px", color: "#868686" }}>
            {formatMessageTime(message.createdAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: "14px",
            lineHeight: "1.6",
            color: "#1D1C1D",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }}
        >
          {message.text}
        </div>
      </div>
    </div>
  );
}

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

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const messagesEndRef = useRef(null);

  const currentMember = members.find(
    (m) => m.id === currentMemberId && m.status === "joined"
  );
  const joinedMembers = members.filter((m) => m.status === "joined");
  const pendingCount = members.length - joinedMembers.length;
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const botTyping = isAwaitingBot(messages);

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
  }, [messages.length, botTyping]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !currentMember || sending) return;

    setSending(true);
    setSendError(null);
    try {
      await dispatch(postGeneralMessage({ text })).unwrap();
      setInput("");
    } catch (err) {
      setSendError(err);
    } finally {
      setSending(false);
    }
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
          <span style={{ fontSize: "13px", color: "#616061" }}>
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
            background: "#E8F5EE",
            border: "1px solid #B7E1C9"
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px", color: "#1D1C1D" }}>
            <CustomerServiceOutlined style={{ color: "#007A5A" }} />
            <strong>Huddle in progress</strong>
            <span style={{ color: "#616061" }}>
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
      <div style={{ flex: 1, overflowY: "auto", paddingRight: "8px" }}>
        {signedOut && (
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E2E2",
              borderRadius: "12px",
              padding: "28px",
              margin: "20px auto",
              maxWidth: "560px",
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#1D1C1D" }}>
              #general is for workspace members
            </div>
            <div style={{ color: "#616061", fontSize: "14px", marginTop: "6px" }}>
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
              background: "#FFFFFF",
              border: "1px solid #E2E2E2",
              borderRadius: "12px",
              padding: "28px",
              margin: "20px auto",
              maxWidth: "560px",
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#1D1C1D" }}>
              This is the very beginning of #general
            </div>
            <div style={{ color: "#616061", fontSize: "14px", marginTop: "6px" }}>
              Invite your teammates by email and start the conversation. Mention{" "}
              <strong>@ai</strong> in a message to bring the AI bot in.
            </div>
          </div>
        )}

        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            member={membersById[message.memberId]}
            isYou={Boolean(currentMember) && message.memberId === currentMember.id}
          />
        ))}

        {botTyping && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 16px",
              color: "#616061",
              fontSize: "13px"
            }}
          >
            <RobotOutlined /> Slack AI is typing… <Spin size="small" />
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
            background: "#FFFFFF",
            border: "1px solid #D0D0D0",
            borderRadius: "10px",
            color: "#616061",
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
          {sendError && (
            <Alert
              type="error"
              showIcon
              title={sendError}
              closable
              onClose={() => setSendError(null)}
              style={{ marginTop: "12px" }}
            />
          )}
          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              background: "#FFFFFF",
              border: "1px solid #D0D0D0",
              borderRadius: "10px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
              display: "flex",
              gap: "12px",
              alignItems: "center"
            }}
          >
            <Input
              variant="borderless"
              placeholder={`Message #general as ${currentMember.name} — mention @ai to ask the bot`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleSend}
              style={{ fontSize: "14px", flex: 1 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={sending}
              disabled={input.trim() === ""}
              style={{
                background: "#007A5A",
                borderColor: "#007A5A",
                fontWeight: 600,
                borderRadius: "6px"
              }}
            >
              Send
            </Button>
          </div>
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
