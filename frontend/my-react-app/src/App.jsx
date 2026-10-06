import { useState, useEffect, useRef } from "react";
import {
  Layout,
  Menu,
  Avatar,
  Input,
  Button,
  Spin,
  Alert,
  Tag,
  Tooltip,
  Popconfirm,
  Badge
} from "antd";
import {
  SendOutlined,
  DeleteOutlined,
  RobotOutlined,
  UserOutlined,
  ThunderboltOutlined,
  NumberOutlined,
  SettingOutlined,
  CheckCircleFilled,
  CustomerServiceOutlined,
  PhoneOutlined
} from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import {
  addMessage,
  sendMessage,
  clearMessages
} from "./features/chat/chatSlice";
import GeneralChannel from "./components/GeneralChannel";
import BotSettings from "./components/BotSettings";
import HuddlePanel from "./components/huddle/HuddlePanel";
import useHuddle, { directRoomId } from "./features/huddle/useHuddle";
import DirectChannel from "./components/DirectChannel";
import MemberAvatar from "./components/general/MemberAvatar";
import { fetchConversations } from "./features/direct/directSlice";
import { fetchMe, verifyLogin } from "./features/general/generalSlice";

const { Header, Sider, Content } = Layout;

const DIRECT_POLL_INTERVAL_MS = 4000;
const AUTH_RETRY_MS = 3000;

const CHANNELS = [
  {
    key: "chat",
    label: "ai-assistant",
    tag: "Slack Bot",
    description: "Direct AI assistance powered by OpenRouter"
  },
  {
    key: "general",
    label: "general",
    description: "Team conversation — invite teammates and mention @ai for help"
  },
  {
    key: "settings",
    label: "bot-settings",
    description: "Bot status, configuration, and Slack usage"
  }
];

const SUGGESTED_PROMPTS = [
  "✨ Summarize key points of a project",
  "💡 Draft a professional Slack announcement",
  "💻 Explain how async/await works in Node.js",
  "📝 Help me write clear documentation"
];

function App() {
  const [input, setInput] = useState("");
  // Invite links look like /?invite=<token> and open #general
  const [inviteToken, setInviteToken] = useState(() =>
    new URLSearchParams(window.location.search).get("invite")
  );
  // Emailed sign-in links look like /?login=<token>; read once, then removed
  const [loginToken] = useState(() =>
    new URLSearchParams(window.location.search).get("login")
  );
  const [activeChannel, setActiveChannel] = useState(
    inviteToken || loginToken ? "general" : "chat"
  );
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const messages = useSelector((state) => state.chat.messages);
  const loading = useSelector((state) => state.chat.loading);
  const error = useSelector((state) => state.chat.error);
  const dispatch = useDispatch();

  // Lives at the app level so a call keeps going while switching channels
  const currentMemberId = useSelector((state) => state.general.currentMemberId);
  const huddle = useHuddle(currentMemberId);

  // Direct messages: the conversation list drives the sidebar and unread badges
  const directState = useSelector((state) => state.direct);
  const directMe =
    currentMemberId && directState.me?.id === currentMemberId ? directState.me : null;
  const sortedConversations = directMe
    ? [...directState.conversations].sort(
        (a, b) =>
          (b.lastMessage?.createdAt || "").localeCompare(a.lastMessage?.createdAt || "") ||
          a.member.name.localeCompare(b.member.name)
      )
    : [];
  const activeDirectId = activeChannel.startsWith("dm:") ? activeChannel.slice(3) : null;
  const activeDirect = activeDirectId
    ? sortedConversations.find((c) => c.member.id === activeDirectId)
    : null;
  const channel = activeDirectId
    ? {
        key: "dm",
        member: activeDirect?.member,
        label: activeDirect?.member.name || "Direct message",
        description: "Direct message · only visible to the two of you"
      }
    : CHANNELS.find((c) => c.key === activeChannel);

  useEffect(() => {
    if (!currentMemberId) return undefined;
    const load = () => dispatch(fetchConversations());
    load();
    const timer = setInterval(load, DIRECT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [dispatch, currentMemberId]);

  const messagesEndRef = useRef(null);

  // Auto-scroll on new message or loading state update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [messages, loading]);

  function handleSend(customText) {
    const textToSend = typeof customText === "string" ? customText : input;

    // Prevent empty sends or sends while loading
    if (!textToSend || textToSend.trim() === "" || loading) {
      return;
    }

    const currentTimestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    const history = messages.map((message) => ({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text
    }));

    dispatch(
      addMessage({
        sender: "user",
        text: textToSend.trim(),
        time: currentTimestamp
      })
    );

    dispatch(
      sendMessage({
        message: textToSend.trim(),
        history: history
      })
    );

    setInput("");
  }

  // Sign in from an emailed link, otherwise confirm the stored session.
  // Retries while the backend is unreachable so a restart doesn't sign you out.
  const hasSession = useSelector((state) => state.general.hasSession);
  const authChecked = useSelector((state) => state.general.authChecked);
  // Links are single-use, so make sure we only ever submit one once
  // (React runs effects twice in development)
  const loginSubmittedRef = useRef(false);
  useEffect(() => {
    if (!loginToken || loginSubmittedRef.current) return;
    loginSubmittedRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    dispatch(verifyLogin(loginToken));
  }, [dispatch, loginToken]);

  useEffect(() => {
    if (loginToken || !hasSession || authChecked) return undefined;
    dispatch(fetchMe());
    const timer = setInterval(() => dispatch(fetchMe()), AUTH_RETRY_MS);
    return () => clearInterval(timer);
  }, [dispatch, loginToken, hasSession, authChecked]);

  function handleInviteHandled() {
    setInviteToken(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function handleClear() {
    dispatch(clearMessages());
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* Slack Aubergine Sidebar */}
      <Sider
        width={240}
        breakpoint="md"
        collapsedWidth={0}
        onCollapse={setSiderCollapsed}
        zeroWidthTriggerStyle={{ top: 12 }}
        style={{
          background: "#3F0E40",
          borderRight: "1px solid rgba(255, 255, 255, 0.1)"
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            alignItems: "center",
            gap: "10px"
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: "#611f69",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: "16px"
            }}
          >
            <ThunderboltOutlined />
          </div>
          <div>
            <div
              style={{
                color: "#FFFFFF",
                fontWeight: 700,
                fontSize: "15px",
                lineHeight: "1.2"
              }}
            >
              Slack AI Workspace
            </div>
            <div
              style={{
                color: "#2bac76",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginTop: "2px"
              }}
            >
              <CheckCircleFilled style={{ fontSize: "10px" }} />
              {directMe ? (
                <span
                  title={`Signed in as ${directMe.name} (${directMe.email})`}
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "150px"
                  }}
                >
                  {directMe.name} · {directMe.role === "owner" ? "Owner" : "Member"}
                </span>
              ) : (
                "Online"
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "16px 16px 6px",
            fontSize: "12px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "rgba(255, 255, 255, 0.6)"
          }}
        >
          Channels
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeChannel]}
          onClick={({ key }) => setActiveChannel(key)}
          style={{
            background: "transparent",
            borderRight: "none"
          }}
          items={CHANNELS.map((c) => ({
            key: c.key,
            icon: c.key === "settings" ? <SettingOutlined /> : <NumberOutlined />,
            label:
              c.key === "general" && huddle.huddle ? (
                <span title="Huddle in progress">
                  {c.label} <CustomerServiceOutlined style={{ color: "#2BAC76" }} />
                </span>
              ) : (
                c.label
              )
          }))}
        />

        <div
          style={{
            padding: "16px 16px 6px",
            fontSize: "12px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "rgba(255, 255, 255, 0.6)"
          }}
        >
          Direct messages
        </div>

        {directMe ? (
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[activeChannel]}
            onClick={({ key }) => setActiveChannel(key)}
            style={{
              background: "transparent",
              borderRight: "none"
            }}
            items={sortedConversations.map(({ member, unread }) => {
              const inCallWith = Boolean(huddle.rooms[directRoomId(directMe.id, member.id)]);
              return {
                key: `dm:${member.id}`,
                icon: <MemberAvatar member={member} size={20} />,
                label: (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "6px"
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontWeight: unread ? 700 : undefined
                      }}
                    >
                      {member.name}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      {inCallWith && (
                        <PhoneOutlined style={{ color: "#2BAC76" }} title="Call in progress" />
                      )}
                      {unread > 0 && <Badge count={unread} size="small" />}
                    </span>
                  </span>
                )
              };
            })}
          />
        ) : null}

        {(!directMe || sortedConversations.length === 0) && (
          <div
            style={{
              padding: "4px 24px 16px",
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.5)"
            }}
          >
            {directMe
              ? "Invite teammates in #general to message them here."
              : "Join #general to message teammates directly."}
          </div>
        )}
      </Sider>

      {/* Main Chat Layout */}
      <Layout style={{ background: "#F8F8F8" }}>
        {/* Channel Top Header */}
        <Header
          style={{
            background: "#FFFFFF",
            borderBottom: "1px solid #E2E2E2",
            // Leave room for the sidebar toggle when the sidebar is collapsed
            padding: siderCollapsed ? "0 24px 0 60px" : "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "64px"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              minWidth: 0
            }}
          >
            <span
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#1D1C1D",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap"
              }}
            >
              {channel.key === "settings" && (
                <SettingOutlined style={{ color: "#616061", fontSize: "16px" }} />
              )}
              {channel.key === "dm" && channel.member && (
                <MemberAvatar member={channel.member} size={24} />
              )}
              {channel.key !== "settings" && channel.key !== "dm" && (
                <NumberOutlined style={{ color: "#616061", fontSize: "16px" }} />
              )}
              {channel.label}
            </span>
            {channel.tag && (
              <Tag color="purple" style={{ marginLeft: "4px" }}>
                {channel.tag}
              </Tag>
            )}
            <span
              style={{
                color: "#616061",
                fontSize: "13px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              {channel.description}
            </span>
          </div>

          {activeChannel === "chat" && (
            <div style={{ flexShrink: 0, marginLeft: "12px" }}>
              <Popconfirm
                title="Clear Conversation"
                description="Are you sure you want to clear all chat messages?"
                onConfirm={handleClear}
                okText="Yes, Clear"
                cancelText="Cancel"
                disabled={messages.length === 0}
              >
                <Tooltip title="Clear chat history">
                  <Button
                    icon={<DeleteOutlined />}
                    danger
                    disabled={messages.length === 0}
                  >
                    Clear History
                  </Button>
                </Tooltip>
              </Popconfirm>
            </div>
          )}
        </Header>

        <Content
          style={{
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            height: "calc(100vh - 64px)",
            boxSizing: "border-box"
          }}
        >
          {activeChannel === "general" && (
            <GeneralChannel
              inviteToken={inviteToken}
              onInviteHandled={handleInviteHandled}
              huddle={huddle}
            />
          )}

          {activeDirectId &&
            (activeDirect && directMe ? (
              <DirectChannel
                key={activeDirectId}
                me={directMe}
                other={activeDirect.member}
                huddle={huddle}
              />
            ) : (
              <div style={{ textAlign: "center", color: "#616061", marginTop: "40px" }}>
                {directMe ? (
                  "This person isn't in the workspace anymore."
                ) : (
                  <Spin />
                )}
              </div>
            ))}

          {activeChannel === "settings" && (
            <BotSettings
              messageCount={messages.length}
              onClearHistory={handleClear}
            />
          )}

          {/* Chat Feed */}
          {activeChannel === "chat" && (
            <>
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  paddingRight: "8px"
                }}
              >
                {/* Empty State / Welcome Screen */}
                {messages.length === 0 && (
                  <div
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #E2E2E2",
                      borderRadius: "12px",
                      padding: "32px",
                      margin: "20px auto",
                      maxWidth: "680px",
                      textAlign: "center",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                    }}
                  >
                    <div
                      style={{
                        width: "56px",
                        height: "56px",
                        borderRadius: "16px",
                        background: "#3F0E40",
                        color: "#FFFFFF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "28px",
                        margin: "0 auto 16px"
                      }}
                    >
                      <RobotOutlined />
                    </div>
                    <h3
                      style={{
                        fontSize: "20px",
                        fontWeight: 700,
                        color: "#1D1C1D",
                        marginBottom: "8px"
                      }}
                    >
                      Welcome to Slack AI Assistant!
                    </h3>
                    <p
                      style={{
                        color: "#616061",
                        fontSize: "14px",
                        marginBottom: "24px"
                      }}
                    >
                      Ask questions, draft content, debug code, or brainstorm ideas right inside your workspace.
                    </p>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "10px",
                        textAlign: "left"
                      }}
                    >
                      {SUGGESTED_PROMPTS.map((prompt, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSend(prompt.replace(/^[^\s]+\s/, ""))}
                          style={{
                            padding: "12px 14px",
                            background: "#F8F8F8",
                            border: "1px solid #E2E2E2",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: "#1D1C1D",
                            transition: "all 0.2s ease"
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "#1164A3";
                            e.currentTarget.style.background = "#F0F7FD";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "#E2E2E2";
                            e.currentTarget.style.background = "#F8F8F8";
                          }}
                        >
                          {prompt}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages List */}
                {messages.map((message, index) => {
                    const isUser = message.sender === "user";

                    return (
                      <div
                        key={index}
                        style={{
                          border: "none",
                          padding: "12px 16px",
                          marginBottom: "8px",
                          borderRadius: "8px",
                          background: isUser ? "transparent" : "#FFFFFF",
                          boxShadow: isUser
                            ? "none"
                            : "0 1px 3px rgba(0,0,0,0.05)",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "14px"
                        }}
                      >
                        <Avatar
                          size={40}
                          icon={isUser ? <UserOutlined /> : <RobotOutlined />}
                          style={{
                            background: isUser ? "#1164A3" : "#3F0E40",
                            color: "#FFFFFF",
                            flexShrink: 0
                          }}
                        />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              marginBottom: "4px"
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 700,
                                color: "#1D1C1D",
                                fontSize: "14px"
                              }}
                            >
                              {isUser ? "You" : "Slack AI"}
                            </span>

                            {!isUser && (
                              <Tag
                                color="purple"
                                style={{
                                  fontSize: "11px",
                                  padding: "0 4px",
                                  lineHeight: "18px"
                                }}
                              >
                                APP
                              </Tag>
                            )}

                            <span
                              style={{
                                fontSize: "12px",
                                color: "#868686"
                              }}
                            >
                              {message.time}
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
                  })}

                {/* Typing Indicator */}
                {loading && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 16px",
                      background: "#FFFFFF",
                      borderRadius: "8px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                      maxWidth: "260px",
                      marginTop: "8px"
                    }}
                  >
                    <Avatar
                      size={32}
                      icon={<RobotOutlined />}
                      style={{ background: "#3F0E40" }}
                    />
                    <Spin size="small" />
                    <span style={{ fontSize: "13px", color: "#616061" }}>
                      AI is generating response...
                    </span>
                  </div>
                )}

                {/* Error Notification */}
                {error && (
                  <Alert
                    title="Error processing request"
                    description={error}
                    type="error"
                    showIcon
                    closable
                    style={{ marginTop: "16px" }}
                  />
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Slack-style Message Composer */}
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
                  placeholder={
                    loading
                      ? "AI is thinking..."
                      : "Message #ai-assistant... (Press Enter to send)"
                  }
                  value={input}
                  disabled={loading}
                  onChange={(e) => setInput(e.target.value)}
                  onPressEnter={() => handleSend()}
                  style={{
                    fontSize: "14px",
                    flex: 1
                  }}
                />

                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => handleSend()}
                  loading={loading}
                  disabled={loading || input.trim() === ""}
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
          )}
        </Content>
      </Layout>

      <HuddlePanel huddle={huddle} />
    </Layout>
  );
}

export default App;