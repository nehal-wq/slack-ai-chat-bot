import { useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Spin } from "antd";
import { CloseOutlined, RobotOutlined } from "@ant-design/icons";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchThread,
  postReply,
  editThreadMessage,
  deleteThreadMessage,
  reactThreadMessage,
  threadClosed
} from "../../features/threads/threadsSlice";
import MessageItem from "../messages/MessageItem";
import Composer from "../messages/Composer";

const BOT_MENTION_PATTERN = /@(ai|slack ai)\b/i;
const AI_MENTION = [{ value: "ai", description: "ask the AI bot" }];
const EMPTY = [];

// Someone asked @ai in the thread and the bot hasn't answered yet
function isAwaitingBot(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === "bot") return false;
    if (messages[i].type === "user" && BOT_MENTION_PATTERN.test(messages[i].text)) return true;
  }
  return false;
}

// Where the thread lives: its label, who can be mentioned, and if you can reply
function useThreadContext({ kind, convId }, me, people) {
  const channel = useSelector((state) =>
    kind === "channel" ? state.channels.list.find((c) => c.id === convId) : null
  );
  const other = useSelector((state) =>
    kind === "dm" ? state.direct.conversations.find((c) => c.member.id === convId)?.member : null
  );

  if (kind === "dm") {
    return {
      label: other?.name || "Direct message",
      mentionable: other ? [other] : [],
      extraMentions: [],
      canReply: Boolean(other)
    };
  }
  if (kind === "channel") {
    const memberIds = channel?.members || [];
    return {
      label: `#${channel?.name || "channel"}`,
      mentionable: people.filter((p) => memberIds.includes(p.id) && p.id !== me.id),
      extraMentions: AI_MENTION,
      canReply: Boolean(channel?.joined),
      cantReplyReason: channel ? `Join #${channel.name} to reply.` : "This channel isn't available."
    };
  }
  return {
    label: "#general",
    mentionable: people.filter((p) => p.id !== me.id),
    extraMentions: AI_MENTION,
    canReply: true
  };
}

function ThreadContent({ thread, me, people }) {
  const { kind, convId, parentId } = thread;
  const dispatch = useDispatch();
  const entry = useSelector((state) => state.threads.byParent[parentId]);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const context = useThreadContext(thread, me, people);

  const parent = entry?.parent;
  const replies = entry?.replies || EMPTY;
  const loaded = Boolean(entry?.loaded);
  const botTyping = loaded && isAwaitingBot(parent ? [parent, ...replies] : replies);
  const lastReplyId = replies[replies.length - 1]?.id;

  const everyone = [me, ...people.filter((p) => p.id !== me.id)];
  const byId = Object.fromEntries(everyone.map((p) => [p.id, p]));
  const memberOf = (id) => byId[id];
  const nameOf = (id) => byId[id]?.name || "Someone";
  const mentionNames = everyone.map((p) => p.name);

  // Mounted fresh for each thread (keyed by parentId), so no reset needed
  useEffect(() => {
    dispatch(fetchThread({ kind, convId, parentId }))
      .unwrap()
      .catch(setError);
  }, [dispatch, kind, convId, parentId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastReplyId, botTyping]);

  async function run(action) {
    setError(null);
    try {
      return await dispatch(action).unwrap();
    } catch (err) {
      setError(err);
      throw err;
    }
  }

  function renderMessage(message) {
    const isBot = message.type === "bot";
    const isYou = message.memberId === me.id;
    const author = byId[message.memberId] || {
      id: message.memberId || message.author,
      name: message.author
    };
    const ids = { kind, convId, messageId: message.id };
    return (
      <MessageItem
        key={message.id}
        message={message}
        author={author}
        isBot={isBot}
        isYou={isYou}
        canEdit={isYou && !isBot}
        canDelete={isYou || (kind !== "dm" && me.role === "owner")}
        myId={me.id}
        myName={me.name}
        mentionNames={mentionNames}
        nameOf={nameOf}
        memberOf={memberOf}
        onEdit={(text) => run(editThreadMessage({ ...ids, text }))}
        onDelete={() => run(deleteThreadMessage(ids)).catch(() => {})}
        onReact={(emoji) => run(reactThreadMessage({ ...ids, emoji })).catch(() => {})}
      />
    );
  }

  const count = parent?.replyCount ?? replies.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)"
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--text)" }}>Thread</div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {context.label}
          </div>
        </div>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={() => dispatch(threadClosed())}
          aria-label="Close thread"
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px 8px", minHeight: 0 }}>
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

        {parent && renderMessage(parent)}

        {parent && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              margin: "10px 4px 12px",
              fontSize: "12px",
              color: "var(--text-tertiary)"
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>
              {count ? `${count} ${count === 1 ? "reply" : "replies"}` : "No replies yet"}
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
        )}

        {!loaded && !error && (
          <div style={{ textAlign: "center", margin: "24px 0" }}>
            <Spin />
          </div>
        )}

        {replies.map(renderMessage)}

        {botTyping && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 12px",
              color: "var(--text-secondary)",
              fontSize: "13px"
            }}
          >
            <RobotOutlined /> Slack AI is typing… <Spin size="small" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ padding: "0 12px 12px" }}>
        {context.canReply ? (
          <Composer
            placeholder="Reply…"
            people={context.mentionable}
            extraMentions={context.extraMentions}
            onSend={(text) => run(postReply({ kind, convId, parentId, text }))}
          />
        ) : (
          <div
            style={{
              marginTop: "12px",
              padding: "12px",
              textAlign: "center",
              color: "var(--text-secondary)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px"
            }}
          >
            {context.cantReplyReason}
          </div>
        )}
      </div>
    </div>
  );
}

// Replies to one message, beside the conversation (a full-screen drawer on
// phones). Opened from "Reply in thread" or a message's reply summary.
function ThreadPanel({ me, people, isMobile }) {
  const dispatch = useDispatch();
  const thread = useSelector((state) => state.threads.open);
  if (!me) return null;

  const content = thread && (
    <ThreadContent key={thread.parentId} thread={thread} me={me} people={people} />
  );

  if (isMobile) {
    return (
      <Drawer
        open={Boolean(thread)}
        onClose={() => dispatch(threadClosed())}
        placement="right"
        size="100%"
        closable={false}
        destroyOnHidden
        styles={{ body: { padding: 0, background: "var(--app-bg)" } }}
      >
        {content}
      </Drawer>
    );
  }

  if (!thread) return null;
  return (
    <aside
      aria-label="Thread"
      style={{
        width: "400px",
        flexShrink: 0,
        height: "calc(100dvh - 64px)",
        borderLeft: "1px solid var(--border)",
        background: "var(--app-bg)",
        boxSizing: "border-box"
      }}
    >
      {content}
    </aside>
  );
}

export default ThreadPanel;
