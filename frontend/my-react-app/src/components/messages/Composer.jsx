import { useState, useMemo, useId } from "react";
import { Button, Mentions } from "antd";
import { SendOutlined } from "@ant-design/icons";
import MemberAvatar from "../general/MemberAvatar";

// Message box with @mention autocomplete. Enter sends, Shift+Enter adds a
// new line; while the mention list is showing, Enter picks a name instead.
function Composer({ placeholder, people, extraMentions = [], onSend, onTyping, disabled }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Tags this composer's name list so we can tell whether it's showing
  const popupClass = `composer-mentions-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const options = useMemo(
    () => [
      ...extraMentions.map(({ value, description }) => ({
        key: value,
        value,
        label: (
          <span>
            <strong>@{value}</strong>{" "}
            <span style={{ color: "var(--text-tertiary)" }}>{description}</span>
          </span>
        )
      })),
      ...people.map((person) => ({
        key: person.id,
        value: person.name,
        label: (
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <MemberAvatar member={person} size={20} />
            {person.name}
          </span>
        )
      }))
    ],
    [people, extraMentions]
  );

  // Is the @mention list actually on screen with names in it? Then Enter
  // picks a name. Checking the real list (not guessing from the text) keeps
  // Enter-to-send working whenever the list isn't shown.
  function mentionListOpen() {
    const popup = document.querySelector(`.${popupClass}`);
    if (!popup || popup.className.includes("-hidden") || !popup.getClientRects().length) {
      return false;
    }
    return Boolean(popup.querySelector("[role='option'], .ant-mentions-dropdown-menu-item"));
  }

  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      await onSend(message);
      setText("");
    } catch {
      // The parent shows the error; keep the draft so nothing is lost
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "10px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: "10px",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        gap: "12px",
        alignItems: "flex-end"
      }}
    >
      <Mentions
        variant="borderless"
        value={text}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        autoSize={{ minRows: 1, maxRows: 6 }}
        placement="top"
        popupClassName={popupClass}
        aria-label={placeholder}
        onChange={(value) => {
          setText(value);
          if (value) onTyping?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !mentionListOpen()) {
            e.preventDefault();
            send();
          }
        }}
        style={{ fontSize: "14px", flex: 1 }}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={send}
        loading={sending}
        disabled={disabled || text.trim() === ""}
        style={{ fontWeight: 600, borderRadius: "6px" }}
      >
        Send
      </Button>
    </div>
  );
}

export default Composer;
