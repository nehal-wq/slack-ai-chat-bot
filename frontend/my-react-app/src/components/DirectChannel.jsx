import { useState, useEffect, useRef } from "react";
import { Button, Alert, Spin, Tooltip, Tag } from "antd";
import {
  AudioOutlined,
  VideoCameraOutlined,
  PhoneOutlined
} from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import {
  fetchDirectMessages,
  fetchOlderDirect,
  sendDirectMessage,
  markDirectRead,
  editDirectMessage,
  deleteDirectMessage,
  reactDirectMessage
} from "../features/direct/directSlice";
import MessageItem from "./messages/MessageItem";
import { threadOpened } from "../features/threads/threadsSlice";
import Composer from "./messages/Composer";
import { directRoomId } from "../features/huddle/useHuddle";
import MemberAvatar from "./general/MemberAvatar";
import { notifyTyping, useTypingNames, typingLabel } from "../features/realtime/useTyping";
import formatMessageTime from "./general/formatMessageTime";

// New messages are pushed instantly; this slow poll is only a safety net
const POLL_INTERVAL_MS = 30000;
const EMPTY_LIST = [];

// Call events ("Missed call", "Call ended · 3m") shown between messages
function CallNotice({ message }) {
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

function DirectChannel({ me, other, huddle }) {
  const dispatch = useDispatch();
  const messages = useSelector(
    (state) => state.direct.messagesByMember[other.id] || EMPTY_LIST
  );
  const loaded = useSelector((state) => Boolean(state.direct.loadedMembers[other.id]));
  const hasMore = useSelector((state) => Boolean(state.direct.hasMoreByMember[other.id]));
  const loadingOlder = useSelector((state) =>
    Boolean(state.direct.loadingOlderByMember[other.id])
  );
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const feedRef = useRef(null);
  const mentionNames = [me.name, other.name];
  const nameOf = (id) => (id === other.id ? other.name : me.name);

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

  // Runs a message action and shows any error above the feed
  async function run(action) {
    setError(null);
    try {
      await dispatch(action).unwrap();
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  // Prepends older history without making the view jump
  async function loadOlder() {
    const feed = feedRef.current;
    const previousHeight = feed?.scrollHeight || 0;
    await run(fetchOlderDirect({ otherId: other.id, before: messages[0].createdAt })).catch(
      () => {}
    );
    requestAnimationFrame(() => {
      if (feed) feed.scrollTop += feed.scrollHeight - previousHeight;
    });
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
      <div ref={feedRef} style={{ flex: 1, overflowY: "auto", paddingRight: "8px", paddingTop: "14px" }}>
        {loaded && hasMore && messages.length > 0 && (
          <div style={{ textAlign: "center", margin: "4px 0 12px" }}>
            <Button size="small" loading={loadingOlder} onClick={loadOlder}>
              Load older messages
            </Button>
          </div>
        )}

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
          if (message.type === "system") return <CallNotice key={message.id} message={message} />;
          const isYou = message.memberId === me.id;
          const ids = { otherId: other.id, id: message.id };
          return (
            <MessageItem
              key={message.id}
              message={message}
              author={isYou ? me : other}
              isYou={isYou}
              canEdit={isYou}
              canDelete={isYou}
              myId={me.id}
              myName={me.name}
              mentionNames={mentionNames}
              nameOf={nameOf}
              onEdit={(text) => run(editDirectMessage({ ...ids, text }))}
              onDelete={() => run(deleteDirectMessage(ids)).catch(() => {})}
              onReact={(emoji) => run(reactDirectMessage({ ...ids, emoji })).catch(() => {})}
              memberOf={(id) => (id === me.id ? me : id === other.id ? other : null)}
              onReply={() =>
                dispatch(
                  threadOpened({ kind: "dm", convId: other.id, parentId: message.id, parent: message })
                )
              }
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
      <Composer
        placeholder={`Message ${other.name}`}
        people={[other]}
        onTyping={() => notifyTyping("dm", other.id)}
        onSend={(text) => run(sendDirectMessage({ otherId: other.id, text }))}
      />
    </>
  );
}

export default DirectChannel;
