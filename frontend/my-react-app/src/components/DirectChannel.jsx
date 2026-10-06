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
import formatMessageTime from "./general/formatMessageTime";

const POLL_INTERVAL_MS = 3000;
const EMPTY_LIST = [];

function DirectMessageRow({ message, author, isYou }) {
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
      <MemberAvatar member={author} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
          <span style={{ fontWeight: 700, color: "#1D1C1D", fontSize: "14px" }}>
            {author.name}
          </span>
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

  // Viewing the conversation marks it read
  useEffect(() => {
    if (lastMessageId) {
      dispatch(markDirectRead({ otherId: other.id }));
    }
  }, [dispatch, me.id, other.id, lastMessageId]);

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
          <MemberAvatar member={other} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "#1D1C1D" }}>{other.name}</div>
            <div
              style={{
                fontSize: "12px",
                color: "#868686",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {other.email}
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
            background: "#E8F5EE",
            border: "1px solid #B7E1C9"
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px", color: "#1D1C1D" }}>
            <PhoneOutlined style={{ color: "#007A5A" }} />
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
              background: "#FFFFFF",
              border: "1px solid #E2E2E2",
              borderRadius: "12px",
              padding: "28px",
              margin: "20px auto",
              maxWidth: "520px",
              textAlign: "center"
            }}
          >
            <MemberAvatar member={other} size={56} />
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#1D1C1D", marginTop: "12px" }}>
              This is the beginning of your conversation with {other.name}
            </div>
            <div style={{ color: "#616061", fontSize: "14px", marginTop: "6px" }}>
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

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
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
          placeholder={`Message ${other.name}`}
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
  );
}

export default DirectChannel;
