import { Fragment, useMemo } from "react";

// Lightweight message formatting, rendered as React elements (never raw HTML):
//   **bold**  _italic_  `code`  ```code block```  https://links  @mentions
//
// mentionNames: names that can be @mentioned (members, "ai", "channel", ...)
// myName: your name, so mentions of you stand out

const SPECIAL_MENTIONS = ["ai", "Slack AI", "channel", "everyone", "here"];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildInlinePattern(mentionNames) {
  const names = [...new Set([...mentionNames, ...SPECIAL_MENTIONS])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const mention = names.length ? `@(?:${names.join("|")})(?![\\w])` : "(?!)";
  return new RegExp(
    [
      "`[^`\\n]+`", // inline code
      "\\*\\*[^*\\n]+\\*\\*", // bold
      "(?<![\\w])_[^_\\n]+_(?![\\w])", // italic
      "https?:\\/\\/[^\\s<]+[^\\s<.,;:!?)\\]'\"]", // link
      mention
    ].join("|"),
    "gi"
  );
}

const codeStyle = {
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: "0.9em",
  background: "var(--surface-subtle)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  padding: "0 4px"
};

function renderInline(text, pattern, myName, keyPrefix) {
  const parts = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("`")) {
      parts.push(
        <code key={key} style={codeStyle}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("_")) {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (/^https?:\/\//i.test(token)) {
      parts.push(
        <a key={key} href={token} target="_blank" rel="noopener noreferrer">
          {token}
        </a>
      );
    } else {
      const isMe = myName && token.slice(1).toLowerCase() === myName.toLowerCase();
      parts.push(
        <span
          key={key}
          style={{
            background: isMe ? "var(--mention-me-bg)" : "var(--accent-subtle)",
            color: isMe ? "var(--text)" : "var(--accent)",
            borderRadius: "3px",
            padding: "0 2px",
            fontWeight: 600
          }}
        >
          {token}
        </span>
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MessageText({ text, mentionNames = [], myName }) {
  const pattern = useMemo(() => buildInlinePattern(mentionNames), [mentionNames]);

  // ```fenced``` blocks first; everything else is inline-formatted text
  const segments = text.split(/```/);
  return (
    <div
      style={{
        fontSize: "14px",
        lineHeight: "1.6",
        color: "var(--text)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word"
      }}
    >
      {segments.map((segment, i) =>
        i % 2 === 1 ? (
          <pre
            key={i}
            style={{
              ...codeStyle,
              display: "block",
              padding: "8px 10px",
              margin: "4px 0",
              whiteSpace: "pre-wrap",
              overflowX: "auto"
            }}
          >
            {segment.replace(/^\n/, "")}
          </pre>
        ) : (
          <Fragment key={i}>{renderInline(segment, pattern, myName, `s${i}`)}</Fragment>
        )
      )}
    </div>
  );
}

export default MessageText;
