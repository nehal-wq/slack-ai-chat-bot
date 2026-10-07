import { useState } from "react";
import { Button, Input, Popconfirm, Popover, Tag, Tooltip } from "antd";
import { CommentOutlined, DeleteOutlined, EditOutlined, SmileOutlined } from "@ant-design/icons";
import MemberAvatar from "../general/MemberAvatar";
import formatMessageTime from "../general/formatMessageTime";
import MessageText from "./MessageText";
import { REACTIONS } from "../../features/messages/reactions";

function ReactionChips({ reactions, myId, nameOf, onReact }) {
  const entries = Object.entries(reactions || {}).filter(([, ids]) => ids.length > 0);
  if (!entries.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(myId);
        const names = ids.map((id) => (id === myId ? "You" : nameOf(id))).join(", ");
        return (
          <Tooltip key={emoji} title={`${names} reacted with ${emoji}`}>
            <button
              type="button"
              onClick={() => onReact(emoji)}
              aria-pressed={mine}
              aria-label={`${emoji} ${ids.length}${mine ? ", including you" : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "1px 8px",
                fontSize: "13px",
                borderRadius: "12px",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "var(--text)",
                background: mine ? "var(--accent-subtle)" : "var(--surface-subtle)",
                border: `1px solid ${mine ? "var(--accent)" : "var(--border)"}`
              }}
            >
              <span>{emoji}</span>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>{ids.length}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ReactionPicker({ onPick }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px" }}>
      {REACTIONS.map((emoji) => (
        <Button
          key={emoji}
          type="text"
          onClick={() => onPick(emoji)}
          aria-label={`React with ${emoji}`}
          style={{ fontSize: "18px", padding: 0, width: 36, height: 36 }}
        >
          {emoji}
        </Button>
      ))}
    </div>
  );
}

// "3 replies · Last reply 10:32 AM" under a message that has a thread
function ThreadSummary({ message, memberOf, onOpen }) {
  const count = message.replyCount;
  const repliers = (message.replyMemberIds || []).slice(-3).map(memberOf).filter(Boolean);
  return (
    <button
      type="button"
      className="thread-summary"
      onClick={onOpen}
      aria-label={`View thread, ${count} ${count === 1 ? "reply" : "replies"}`}
    >
      {repliers.map((member) => (
        <MemberAvatar key={member.id} member={member} size={20} />
      ))}
      <span className="thread-summary-count">
        {count} {count === 1 ? "reply" : "replies"}
      </span>
      {message.lastReplyAt && (
        <span className="thread-summary-time">
          Last reply {formatMessageTime(message.lastReplyAt)}
        </span>
      )}
    </button>
  );
}

// One chat message with hover actions. Used by #general, channels, DMs and
// threads. `onReply` (optional) adds "Reply in thread" and the reply summary.
function MessageItem({
  message,
  author,
  isBot = false,
  isYou = false,
  canEdit = false,
  canDelete = false,
  myId,
  myName,
  mentionNames,
  nameOf,
  onEdit,
  onDelete,
  onReact,
  onReply,
  memberOf = () => null
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  function startEdit() {
    setDraft(message.text);
    setEditing(true);
  }

  async function saveEdit() {
    const text = draft.trim();
    if (!text) return;
    if (text === message.text) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onEdit(text);
      setEditing(false);
    } catch {
      // The parent shows the error; stay in edit mode so the text isn't lost
    } finally {
      setSaving(false);
    }
  }

  const deleted = Boolean(message.deleted);
  const actionsAvailable = !deleted && !editing;

  return (
    <div
      className="message-item"
      style={{
        position: "relative",
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
      <MemberAvatar member={author} bot={isBot} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "2px",
            flexWrap: "wrap"
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--text)", fontSize: "14px" }}>
            {author.name}
          </span>
          {isBot && (
            <Tag color="purple" style={{ fontSize: "11px", padding: "0 4px", lineHeight: "18px" }}>
              APP
            </Tag>
          )}
          {isYou && (
            <Tag color="blue" style={{ fontSize: "11px", lineHeight: "18px" }}>
              you
            </Tag>
          )}
          <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            {formatMessageTime(message.createdAt)}
          </span>
          {message.editedAt && !deleted && (
            <Tooltip title={`Edited ${formatMessageTime(message.editedAt)}`}>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>(edited)</span>
            </Tooltip>
          )}
        </div>

        {deleted && (
          <div style={{ fontSize: "14px", color: "var(--text-tertiary)", fontStyle: "italic" }}>
            This message was deleted.
          </div>
        )}

        {!deleted && editing && (
          <div>
            <Input.TextArea
              value={draft}
              autoSize={{ minRows: 1, maxRows: 8 }}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              autoFocus
              aria-label="Edit message"
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "6px", alignItems: "center" }}>
              <Button size="small" type="primary" loading={saving} onClick={saveEdit}>
                Save
              </Button>
              <Button size="small" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                Enter to save · Esc to cancel
              </span>
            </div>
          </div>
        )}

        {!deleted && !editing && (
          <MessageText text={message.text} mentionNames={mentionNames} myName={myName} />
        )}

        {!deleted && (
          <ReactionChips
            reactions={message.reactions}
            myId={myId}
            nameOf={nameOf}
            onReact={onReact}
          />
        )}

        {onReply && message.replyCount > 0 && (
          <ThreadSummary message={message} memberOf={memberOf} onOpen={onReply} />
        )}
      </div>

      {actionsAvailable && (
        <div
          className="message-actions"
          style={{
            position: "absolute",
            top: "-12px",
            right: "12px",
            display: "flex",
            gap: "2px",
            padding: "2px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            boxShadow: "var(--shadow-md)"
          }}
        >
          <Popover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            trigger="click"
            placement="bottomRight"
            content={
              <ReactionPicker
                onPick={(emoji) => {
                  setPickerOpen(false);
                  onReact(emoji);
                }}
              />
            }
          >
            <Tooltip title="Add reaction">
              <Button type="text" size="small" icon={<SmileOutlined />} aria-label="Add reaction" />
            </Tooltip>
          </Popover>
          {onReply && (
            <Tooltip title="Reply in thread">
              <Button
                type="text"
                size="small"
                icon={<CommentOutlined />}
                onClick={onReply}
                aria-label="Reply in thread"
              />
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip title="Edit">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={startEdit}
                aria-label="Edit message"
              />
            </Tooltip>
          )}
          {canDelete && (
            <Popconfirm
              title="Delete this message?"
              description="Everyone will see that it was deleted."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={onDelete}
            >
              <Tooltip title="Delete">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="Delete message"
                />
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      )}
    </div>
  );
}

export default MessageItem;
