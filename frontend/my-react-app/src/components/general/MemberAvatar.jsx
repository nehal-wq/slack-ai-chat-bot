import { Avatar } from "antd";
import { RobotOutlined } from "@ant-design/icons";

const AVATAR_COLORS = [
  "#1164A3",
  "#007A5A",
  "#E8912D",
  "#CD2553",
  "#2BAC76",
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

function MemberAvatar({ member, size = 40, bot = false }) {
  if (bot) {
    return (
      <Avatar
        size={size}
        icon={<RobotOutlined />}
        style={{ background: "#3F0E40", color: "#FFFFFF", flexShrink: 0 }}
      />
    );
  }

  return (
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
}

export default MemberAvatar;
