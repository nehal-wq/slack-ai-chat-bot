import { useState, useEffect, useRef } from "react";
import { Avatar, Button, Alert, Spin } from "antd";
import { TeamOutlined, LockOutlined, NumberOutlined, RobotOutlined } from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import {
  fetchChannelMessages,
  fetchOlderChannel,
  joinChannel,
  postChannelMessage,
  editChannelMessage,
  deleteChannelMessage,
  reactChannelMessage
} from "../features/channels/channelsSlice";
import MessageItem from "./messages/MessageItem";
import { threadOpened } from "../features/threads/threadsSlice";
import Composer from "./messages/Composer";
import MemberAvatar from "./general/MemberAvatar";
import formatMessageTime from "./general/formatMessageTime";
import ChannelDetailsDrawer from "./channels/ChannelDetailsDrawer";
import { notifyTyping, useTypingNames, typingLabel } from "../features/realtime/useTyping";

// New messages are pushed instantly; this slow poll is only a safety net
const POLL_INTERVAL_MS = 30000;
const EMPTY_LIST = [];
const BOT_MENTION_PATTERN = /@(ai|slack ai)\b/i;
const CHANNEL_MENTIONS = [
  { value: "ai", description: "ask the AI bot" },
  { value: "channel", description: "notify everyone in this channel" }
];

function SystemNotice({ message }) {
  return (
    <div style={{ textAlign: "center", fontSize: "12px", color: "var(--text-tertiary)", margin: "10px 0" }}>
      {message.text} · {formatMessageTime(message.createdAt)}
    </div>
  );
}

function isAwaitingBot(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === "bot") return false;
    if (messages[i].type === "user" && BOT_MENTION_PATTERN.test(messages[i].text)) return true;
  }
  return false;
}

// A channel other than #general: preview it, join it, and chat in it
function ChannelView({ channel, me, people, onLeft }) {
  const dispatch = useDispatch();
  const messages = useSelector((state) => state.channels.messagesById[channel.id] || EMPTY_LIST);
  const loaded = useSelector((state) => Boolean(state.channels.loadedById[channel.id]));
  const hasMore = useSelector((state) => Boolean(state.channels.hasMoreById[channel.id]));
  const loadingOlder = useSelector((state) => Boolean(state.channels.loadingOlderById[channel.id]));
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const feedRef = useRef(null);
  const endRef = useRef(null);

  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const members = channel.members.map((id) => byId[id]).filter(Boolean);
  const mentionNames = members.map((m) => m.name);
  const nameOf = (id) => byId[id]?.name || "Someone";
  const lastMessageId = messages[messages.length - 1]?.id;
  const botTyping = isAwaitingBot(messages);
  const typingText = typingLabel(useTypingNames("channel", channel.id));

  useEffect(() => {
    const load = () =>
      dispatch(fetchChannelMessages(channel.id))
        .unwrap()
        .then(() => setError(null))
        .catch(setError);
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [dispatch, channel.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId, botTyping]);

  async function run(action) {
    setError(null);
    try {
      return await dispatch(action).unwrap();
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  async function loadOlder() {
    const feed = feedRef.current;
    const previousHeight = feed?.scrollHeight || 0;
    await run(fetchOlderChannel({ id: channel.id, before: messages[0].createdAt })).catch(() => {});
    requestAnimationFrame(() => {
      if (feed) feed.scrollTop += feed.scrollHeight - previousHeight;
    });
  }

  async function join() {
    setJoining(true);
    await run(joinChannel(channel.id)).catch(() => {});
    setJoining(false);
  }

  return (
    <>
      {/* Toolbar: topic, members, details */}
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
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          aria-label="Channel members"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontFamily: "inherit",
            fontSize: "13px"
          }}
        >
          <Avatar.Group max={{ count: 4 }} size={26}>
            {members.map((m) => (
              <MemberAvatar key={m.id} member={m} size={26} />
            ))}
          </Avatar.Group>
          {members.length} {members.length === 1 ? "member" : "members"}
        </button>
        <div style={{ display: "flex", gap: "8px" }}>
          {!channel.joined && (
            <Button type="primary" loading={joining} onClick={join}>
              Join channel
            </Button>
          )}
          <Button icon={<TeamOutlined />} onClick={() => setDetailsOpen(true)}>
            Details
          </Button>
        </div>
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: "12px" }}
        />
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

        {loaded && messages.every((m) => m.type === "system") && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "24px",
              margin: "12px auto 20px",
              maxWidth: "560px",
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)" }}>
              {channel.private ? <LockOutlined /> : <NumberOutlined />} {channel.name}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "6px" }}>
              {channel.topic || "This is the very beginning of the channel."} Mention{" "}
              <strong>@ai</strong> to bring the AI bot in.
            </div>
          </div>
        )}

        {messages.map((message) => {
          if (message.type === "system") return <SystemNotice key={message.id} message={message} />;
          const isBot = message.type === "bot";
          const isYou = message.memberId === me.id;
          const author = byId[message.memberId] || {
            id: message.memberId || message.author,
            name: message.author
          };
          const ids = { id: channel.id, messageId: message.id };
          return (
            <MessageItem
              key={message.id}
              message={message}
              author={author}
              isBot={isBot}
              isYou={isYou}
              canEdit={isYou && !isBot}
              canDelete={isYou || me.role === "owner"}
              myId={me.id}
              myName={me.name}
              mentionNames={mentionNames}
              nameOf={nameOf}
              onEdit={(text) => run(editChannelMessage({ ...ids, text }))}
              onDelete={() => run(deleteChannelMessage(ids)).catch(() => {})}
              onReact={(emoji) => run(reactChannelMessage({ ...ids, emoji })).catch(() => {})}
              memberOf={(id) => byId[id]}
              onReply={() =>
                dispatch(
                  threadOpened({
                    kind: "channel",
                    convId: channel.id,
                    parentId: message.id,
                    parent: message
                  })
                )
              }
            />
          );
        })}

        {botTyping && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 16px", color: "var(--text-secondary)", fontSize: "13px" }}>
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

        <div ref={endRef} />
      </div>

      {channel.joined ? (
        <Composer
          placeholder={`Message #${channel.name}`}
          people={members.filter((m) => m.id !== me.id)}
          extraMentions={CHANNEL_MENTIONS}
          onTyping={() => notifyTyping("channel", channel.id)}
          onSend={(text) => run(postChannelMessage({ id: channel.id, text }))}
        />
      ) : (
        <div
          style={{
            marginTop: "16px",
            padding: "16px",
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap"
          }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            You&apos;re previewing <strong>#{channel.name}</strong>. Join to send messages.
          </span>
          <Button type="primary" loading={joining} onClick={join}>
            Join channel
          </Button>
        </div>
      )}

      <ChannelDetailsDrawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        channel={channel}
        me={me}
        people={people}
        onLeft={(left) => {
          setDetailsOpen(false);
          onLeft(left);
        }}
      />
    </>
  );
}

export default ChannelView;
