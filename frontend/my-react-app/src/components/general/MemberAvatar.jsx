import { Avatar } from "antd";
import { RobotOutlined } from "@ant-design/icons";

// All dark enough for white initials (at least 4.3:1 contrast)
const AVATAR_COLORS = [
  "#1164A3",
  "#007A5A",
  "#B5650F",
  "#CD2553",
  "#2E7D32",
  "#4A154B",
  "#0B7A8A",
  "#8E5A00"
];

function colorFor(id = "") {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name = "?") {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

// online: true/false shows a green/hollow presence dot; leave undefined to hide it
function MemberAvatar({ member, size = 40, bot = false, online }) {
  if (bot) {
    return (
      <Avatar
        size={size}
        icon={<RobotOutlined />}
        style={{ background: "#3F0E40", color: "#FFFFFF", flexShrink: 0 }}
      />
    );
  }

  const avatar = (
    <Avatar
      size={size}
      style={{
        background: member.status === "invited" ? "#BDBDBD" : colorFor(member.id),
        color: "#FFFFFF",
        flexShrink: 0,
        fontWeight: 600
      }}
    >
      {initials(member.name)}
    </Avatar>
  );

  if (online === undefined) return avatar;

  const dot = Math.max(8, Math.round(size * 0.32));
  return (
    <span
      style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
      title={online ? "Online" : "Offline"}
    >
      {avatar}
      <span
        aria-label={online ? "Online" : "Offline"}
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          width: dot,
          height: dot,
          borderRadius: "50%",
          background: online ? "#2BAC76" : "var(--surface)",
          border: online ? "2px solid var(--surface)" : "2px solid var(--text-tertiary)",
          boxSizing: "border-box"
        }}
      />
    </span>
  );
}

export default MemberAvatar;
