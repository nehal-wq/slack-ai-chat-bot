import { useState, useEffect, useRef } from "react";
import { Button, Input, Alert, Spin, Tooltip, Tag } from "antd";
import {
  SendOutlined,
  AudioOutlined,
  VideoCameraOutlined,
  PhoneOutlined
} from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import {
  fetchDirectMessages,
  sendDirectMessage,
  markDirectRead
} from "../features/direct/directSlice";
import { directRoomId } from "../features/huddle/useHuddle";
import MemberAvatar from "./general/MemberAvatar";
import { notifyTyping, useTypingNames, typingLabel } from "../features/realtime/useTyping";
import formatMessageTime from "./general/formatMessageTime";

// New messages are pushed instantly; this slow poll is only a safety net
const POLL_INTERVAL_MS = 30000;
const EMPTY_LIST = [];

function DirectMessageRow({ message, author, isYou }) {
  if (message.type === "system") {
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

  return (
    <div
      style={{
        padding: "10px 16px",
        marginBottom: "6px",
        borderRadius: "8px",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        alignItems: "flex-start",
        gap: "14px"
      }}
    >
      <MemberAvatar member={author} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
          <span style={{ fontWeight: 700, color: "var(--text)", fontSize: "14px" }}>
            {author.name}
          </span>
          {isYou && <Tag color="blue" style={{ fontSize: "11px", lineHeight: "18px" }}>you</Tag>}
          <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            {formatMessageTime(message.createdAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: "14px",
            lineHeight: "1.6",
            color: "var(--text)",
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

function DirectChannel({ me, other, huddle }) {
  const dispatch = useDispatch();
  const messages = useSelector(
    (state) => state.direct.messagesByMember[other.id] || EMPTY_LIST
  );
  const loaded = useSelector((state) => Boolean(state.direct.loadedMembers[other.id]));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  const room = directRoomId(me.id, other.id);
  const isOnline = useSelector((state) => state.general.online.includes(other.id));
  const typingText = typingLabel(useTypingNames("dm", other.id));
  const call = huddle.rooms[room];
  const inThisCall = huddle.inCall && huddle.activeRoom === room;
  const lastMessageId = messages[messages.length - 1]?.id;

  // Poll so new messages and call events show up
  useEffect(() => {
    const load = () =>
      dispatch(fetchDirectMessages({ otherId: other.id }))
        .unwrap()
        .then(() => setError(null))
        .catch(setError);
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [dispatch, me.id, other.id]);

  // Viewing the conversation marks it read, but only while the tab is
  // visible, so messages that arrive while you're away stay unread
  useEffect(() => {
    const markRead = () => {
      if (lastMessageId && !document.hidden) {
        dispatch(markDirectRead({ otherId: other.id }));
      }
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [dispatch, other.id, lastMessageId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      await dispatch(sendDirectMessage({ otherId: other.id, text })).unwrap();
      setInput("");
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  function startCall(withVideo) {
    huddle.join(withVideo, room, other.name);
  }

  let callHint = "";
  if (!huddle.connected) callHint = "Connecting to the call server…";
  else if (huddle.inCall && !inThisCall) callHint = "Leave your current call first";
  const canCall = huddle.connected && !huddle.inCall;
  const incoming = call && !inThisCall && !call.participants.some((p) => p.memberId === me.id);

  return (
    <>
      {/* Conversation toolbar: who you're talking to + call buttons */}
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
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <MemberAvatar member={other} size={32} online={isOnline} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "var(--text)" }}>{other.name}</div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {isOnline ? "Active now" : "Away"} · {other.email}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {inThisCall ? (
            <Tag color="green" icon={<PhoneOutlined />} style={{ margin: 0, padding: "4px 10px" }}>
              On a call
            </Tag>
          ) : (
            <>
              <Tooltip title={callHint}>
                <Button
                  icon={<AudioOutlined />}
                  onClick={() => startCall(false)}
                  disabled={!canCall}
                  loading={huddle.joining}
                >
                  Call
                </Button>
              </Tooltip>
              <Tooltip title={callHint || "Video call"}>
                <Button
                  icon={<VideoCameraOutlined />}
                  onClick={() => startCall(true)}
                  disabled={!canCall}
                  aria-label="Video call"
                />
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {incoming && (
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
            <PhoneOutlined style={{ color: "var(--brand-text)" }} />
            <strong>{call.startedBy} is calling…</strong>
          </span>
          <span style={{ display: "flex", gap: "8px" }}>
            <Button
              type="primary"
              size="small"
              icon={<AudioOutlined />}
              onClick={() => startCall(false)}
              disabled={!canCall}
              style={{ background: "#007A5A", borderColor: "#007A5A" }}
            >
              Accept
            </Button>
            <Button
              size="small"
              icon={<VideoCameraOutlined />}
              onClick={() => startCall(true)}
              disabled={!canCall}
            >
              With video
            </Button>
          </span>
        </div>
      )}

      {error && (
        <Alert type="error" showIcon title={error} style={{ marginBottom: "12px" }} />
      )}

      {/* Message feed */}
      <div style={{ flex: 1, overflowY: "auto", paddingRight: "8px" }}>
        {!loaded && !error && (
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
              maxWidth: "520px",
              textAlign: "center"
            }}
          >
            <MemberAvatar member={other} size={56} />
            <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text)", marginTop: "12px" }}>
              This is the beginning of your conversation with {other.name}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "6px" }}>
              Messages here are only visible to the two of you. Use the call buttons above for a
              quick audio or video call.
            </div>
          </div>
        )}

        {messages.map((message) => {
          const isYou = message.memberId === me.id;
          return (
            <DirectMessageRow
              key={message.id}
              message={message}
              author={isYou ? me : other}
              isYou={isYou}
            />
          );
        })}

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

      {/* Composer */}
      <div
        style={{
          marginTop: "16px",
          padding: "12px",
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "10px",
          boxShadow: "var(--shadow-md)",
          display: "flex",
          gap: "12px",
          alignItems: "center"
        }}
      >
        <Input
          variant="borderless"
          placeholder={`Message ${other.name}`}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (e.target.value) notifyTyping("dm", other.id);
          }}
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
  );
}

export default DirectChannel;
