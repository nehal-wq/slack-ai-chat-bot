import { useState, useEffect, useCallback } from "react";
import { Button, Descriptions, Tag, Popconfirm, Badge, Segmented } from "antd";
import {
  ReloadOutlined,
  DeleteOutlined,
  ApiOutlined,
  SlackOutlined,
  ToolOutlined,
  TeamOutlined,
  BgColorsOutlined,
  SunOutlined,
  MoonOutlined,
  DesktopOutlined,
  BellOutlined
} from "@ant-design/icons";
import { useTheme } from "../theme/themeContext";
import { useDispatch, useSelector } from "react-redux";
import { API_BASE as API_URL } from "../config";
import { fetchGeneral } from "../features/general/generalSlice";
import InvitePermissionSetting from "./general/InvitePermissionSetting";
import NotificationSettings from "./NotificationSettings";

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  padding: "20px",
  marginBottom: "16px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
};

const cardTitleStyle = {
  fontSize: "15px",
  fontWeight: 700,
  color: "var(--text)",
  marginBottom: "14px",
  display: "flex",
  alignItems: "center",
  gap: "8px"
};

function BotSettings({ messageCount, onClearHistory }) {
  const dispatch = useDispatch();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const currentMember = useSelector((state) =>
    state.general.members.find((m) => m.id === state.general.currentMemberId)
  );
  const currentMemberId = useSelector((state) => state.general.currentMemberId);
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch(API_URL);
      const data = await response.json();
      setHealth({ online: response.ok, ...data });
    } catch {
      setHealth({ online: false });
    } finally {
      setChecking(false);
      setCheckedAt(new Date().toLocaleTimeString());
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    checkHealth();
  }, [checkHealth]);

  // Workspace settings live with #general; load them if not loaded yet
  useEffect(() => {
    if (currentMemberId) dispatch(fetchGeneral());
  }, [dispatch, currentMemberId]);

  let statusBadge = <Badge status="processing" text="Checking..." />;
  if (!checking && health?.online) {
    statusBadge = <Badge status="success" text="Online" />;
  } else if (!checking) {
    statusBadge = <Badge status="error" text="Offline" />;
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingRight: "8px" }}>
      <div style={cardStyle}>
        <div style={{ ...cardTitleStyle, justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ApiOutlined /> Backend Status
          </span>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={checking}
            onClick={checkHealth}
          >
            Refresh
          </Button>
        </div>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Status">{statusBadge}</Descriptions.Item>
          <Descriptions.Item label="Endpoint">{API_URL}</Descriptions.Item>
          <Descriptions.Item label="AI Model">
            {health?.model ? <Tag color="purple">{health.model}</Tag> : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Provider">OpenRouter</Descriptions.Item>
          <Descriptions.Item label="Last checked">{checkedAt || "—"}</Descriptions.Item>
        </Descriptions>
        {!checking && !health?.online && (
          <div style={{ color: "var(--danger-text)", fontSize: "13px", marginTop: "10px" }}>
            Can't reach the backend. Start it with <code>npm start</code> in{" "}
            <code>backend/ai-chat-backend</code>.
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <BgColorsOutlined /> Appearance
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap"
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: "var(--text)" }}>Theme</div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              System follows your device&apos;s light or dark setting. Saved on this device.
            </div>
          </div>
          <Segmented
            value={themeMode}
            onChange={setThemeMode}
            options={[
              { label: "Light", value: "light", icon: <SunOutlined /> },
              { label: "Dark", value: "dark", icon: <MoonOutlined /> },
              { label: "System", value: "system", icon: <DesktopOutlined /> }
            ]}
          />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <BellOutlined /> Notifications
        </div>
        <NotificationSettings />
      </div>

      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <TeamOutlined /> Workspace
        </div>
        {currentMember ? (
          <InvitePermissionSetting currentMember={currentMember} />
        ) : (
          <div style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>
            Sign in to #general to see workspace settings.
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <ToolOutlined /> Conversation
        </div>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Messages in #ai-assistant">
            {messageCount}
          </Descriptions.Item>
          <Descriptions.Item label="History sent per request">
            Last 15 messages
          </Descriptions.Item>
        </Descriptions>
        <Popconfirm
          title="Clear Conversation"
          description="Are you sure you want to clear all chat messages?"
          onConfirm={onClearHistory}
          okText="Yes, Clear"
          cancelText="Cancel"
          disabled={messageCount === 0}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={messageCount === 0}
            style={{ marginTop: "14px" }}
          >
            Clear #ai-assistant History
          </Button>
        </Popconfirm>
      </div>

      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <SlackOutlined /> Using the Bot in Slack
        </div>
        <ol
          style={{
            margin: 0,
            paddingLeft: "20px",
            color: "var(--text)",
            fontSize: "14px",
            lineHeight: "1.8"
          }}
        >
          <li>Invite the bot to a channel: <code>/invite @Slack AI</code></li>
          <li>Mention it with your question: <code>@Slack AI how do I…?</code></li>
          <li>Ask follow-ups — it remembers the last 15 exchanges per channel.</li>
          <li>Long answers are split automatically to fit Slack's message limit.</li>
        </ol>
      </div>
    </div>
  );
}

export default BotSettings;
