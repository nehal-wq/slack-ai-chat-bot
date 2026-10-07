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
  Badge,
  Grid
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
  PhoneOutlined,
  SunOutlined,
  MoonOutlined,
  LockOutlined,
  PlusOutlined
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
import { fetchChannels } from "./features/channels/channelsSlice";
import ChannelView from "./components/ChannelView";
import CreateChannelModal from "./components/channels/CreateChannelModal";
import BrowseChannelsModal from "./components/channels/BrowseChannelsModal";
import ThreadPanel from "./components/threads/ThreadPanel";
import { threadClosed, threadViewKey } from "./features/threads/threadsSlice";
import { fetchMe, verifyLogin } from "./features/general/generalSlice";
import { useTheme } from "./theme/themeContext";
import useRealtimeSync from "./features/realtime/useRealtimeSync";

const { Header, Sider, Content } = Layout;

// Messages arrive instantly over the realtime connection; this slow poll is
// only a safety net in case a pushed event is ever missed
const DIRECT_POLL_INTERVAL_MS = 30000;
// Below Ant Design's "md" breakpoint (768px) the sidebar collapses
const MOBILE_MAX_WIDTH = 767;
// Above the floating call panel (1000) so the open sidebar is never covered
const SIDEBAR_Z_INDEX = 1100;
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
  // Start collapsed on small screens so the first frame never renders the
  // 240px sidebar (phones would zoom out to fit it and stay zoomed out)
  const [siderCollapsed, setSiderCollapsed] = useState(
    () => window.matchMedia?.(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches ?? false
  );
  const { resolved: resolvedTheme, setMode: setThemeMode } = useTheme();
  // Phones and small tablets: tighter spacing, icon-only buttons
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
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
  // Channels beyond #general ("ch:<id>")
  const channelList = useSelector((state) => state.channels.list);
  const channelsLoaded = useSelector((state) => state.channels.listLoaded);
  const unseenChannels = useSelector((state) => state.channels.unseen);
  const joinedChannels = channelList.filter((c) => c.joined);
  const activeChannelId = activeChannel.startsWith("ch:") ? activeChannel.slice(3) : null;
  const activeChannelInfo = activeChannelId
    ? channelList.find((c) => c.id === activeChannelId)
    : null;

  // Everyone in the workspace (for channel members and @mentions)
  const generalMembers = useSelector((state) => state.general.members);
  const people = generalMembers.length
    ? generalMembers.filter((m) => m.status === "joined")
    : [directMe, ...sortedConversations.map((c) => c.member)].filter(Boolean);

  let channel = CHANNELS.find((c) => c.key === activeChannel);
  if (activeDirectId) {
    channel = {
      key: "dm",
      member: activeDirect?.member,
      label: activeDirect?.member.name || "Direct message",
      description: "Direct message · only visible to the two of you"
    };
  } else if (activeChannelId) {
    channel = {
      key: "channel",
      private: activeChannelInfo?.private,
      label: activeChannelInfo?.name || "channel",
      description:
        activeChannelInfo?.topic ||
        (activeChannelInfo?.private ? "Private channel" : "Public channel")
    };
  }

  useEffect(() => {
    if (!currentMemberId) return undefined;
    const load = () => {
      dispatch(fetchConversations());
      dispatch(fetchChannels());
    };
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
    if (!textToSend || textToSend.trim() === "" || loading || !currentMemberId) {
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

  // Picking a channel on a phone closes the sidebar, like Slack's mobile app
  // A thread belongs to one conversation; leaving it closes the panel
  const openThread = useSelector((state) => state.threads.open);
  useEffect(() => {
    if (openThread && threadViewKey(openThread) !== activeChannel) dispatch(threadClosed());
  }, [dispatch, openThread, activeChannel]);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  function openChannel(key) {
    if (key === "channels:add") {
      setBrowseOpen(true);
      return;
    }
    setActiveChannel(key);
    if (isMobile) setSiderCollapsed(true);
  }

  // Pushed messages, presence, unread counts, tab title, desktop notifications
  const onlineIds = useSelector((state) => state.general.online);
  const unseenGeneral = useSelector((state) => state.general.unseenCount);
  useRealtimeSync({
    currentMemberId,
    myName: directMe?.name,
    activeChannel,
    openChannel
  });

  function handleInviteHandled() {
    setInviteToken(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function handleClear() {
    dispatch(clearMessages());
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* Phones: dim the page behind the open sidebar; tapping it closes */}
      {isMobile && !siderCollapsed && (
        <div
          aria-hidden="true"
          onClick={() => setSiderCollapsed(true)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            zIndex: SIDEBAR_Z_INDEX - 1
          }}
        />
      )}

      {/* Slack Aubergine Sidebar (slides over the page on phones) */}
      <Sider
        width={240}
        breakpoint="md"
        collapsedWidth={0}
        collapsed={siderCollapsed}
        onCollapse={setSiderCollapsed}
        zeroWidthTriggerStyle={{ top: 12 }}
        style={{
          background: "var(--sidebar)",
          borderRight: "1px solid rgba(255, 255, 255, 0.1)",
          ...(isMobile && {
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            zIndex: SIDEBAR_Z_INDEX
          })
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
          onClick={({ key }) => openChannel(key)}
          style={{
            background: "transparent",
            borderRight: "none"
          }}
          items={[
            ...CHANNELS.filter((c) => c.key !== "settings"),
            ...joinedChannels.map((c) => ({ key: `ch:${c.id}`, channelInfo: c })),
            ...(directMe ? [{ key: "channels:add" }] : []),
            ...CHANNELS.filter((c) => c.key === "settings")
          ].map((c) => {
            if (c.key === "channels:add") {
              return {
                key: c.key,
                icon: <PlusOutlined />,
                label: <span style={{ opacity: 0.8 }}>Add channels</span>
              };
            }
            if (c.channelInfo) {
              const unseen = unseenChannels[c.channelInfo.id] || 0;
              return {
                key: c.key,
                icon: c.channelInfo.private ? <LockOutlined /> : <NumberOutlined />,
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
                        fontWeight: unseen ? 700 : undefined,
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                      }}
                    >
                      {c.channelInfo.name}
                    </span>
                    {unseen > 0 && <Badge count={unseen} size="small" />}
                  </span>
                )
              };
            }
            return {
            key: c.key,
            icon: c.key === "settings" ? <SettingOutlined /> : <NumberOutlined />,
            label:
              c.key === "general" ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px"
                  }}
                >
                  <span style={{ fontWeight: unseenGeneral ? 700 : undefined }}>{c.label}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    {huddle.huddle && (
                      <CustomerServiceOutlined
                        style={{ color: "#2BAC76" }}
                        title="Huddle in progress"
                      />
                    )}
                    {unseenGeneral > 0 && <Badge count={unseenGeneral} size="small" />}
                  </span>
                </span>
              ) : (
                c.label
              )
            };
          })}
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
            onClick={({ key }) => openChannel(key)}
            style={{
              background: "transparent",
              borderRight: "none"
            }}
            items={sortedConversations.map(({ member, unread }) => {
              const inCallWith = Boolean(huddle.rooms[directRoomId(directMe.id, member.id)]);
              return {
                key: `dm:${member.id}`,
                icon: (
                  <MemberAvatar member={member} size={20} online={onlineIds.includes(member.id)} />
                ),
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
      <Layout style={{ background: "var(--app-bg)" }}>
        {/* Channel Top Header */}
        <Header
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
            // Leave room for the sidebar toggle when the sidebar is collapsed
            padding: siderCollapsed
              ? `0 ${isMobile ? 12 : 24}px 0 60px`
              : "0 24px",
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
                color: "var(--text)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap"
              }}
            >
              {channel.key === "settings" && (
                <SettingOutlined style={{ color: "var(--text-secondary)", fontSize: "16px" }} />
              )}
              {channel.key === "dm" && channel.member && (
                <MemberAvatar member={channel.member} size={24} />
              )}
              {channel.key === "channel" && channel.private && (
                <LockOutlined style={{ color: "var(--text-secondary)", fontSize: "16px" }} />
              )}
              {channel.key !== "settings" && channel.key !== "dm" && !channel.private && (
                <NumberOutlined style={{ color: "var(--text-secondary)", fontSize: "16px" }} />
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
                color: "var(--text-secondary)",
                fontSize: "13px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              {channel.description}
            </span>
          </div>

          <div
            style={{
              flexShrink: 0,
              marginLeft: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
          >
            <Tooltip title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              <Button
                type="text"
                aria-label="Toggle dark mode"
                icon={resolvedTheme === "dark" ? <SunOutlined /> : <MoonOutlined />}
                onClick={() => setThemeMode(resolvedTheme === "dark" ? "light" : "dark")}
              />
            </Tooltip>
          {activeChannel === "chat" && (
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
                    aria-label="Clear chat history"
                  >
                    {!isMobile && "Clear History"}
                  </Button>
                </Tooltip>
              </Popconfirm>
          )}
          </div>
        </Header>

        <div style={{ display: "flex", minHeight: 0 }}>
        <Content
          style={{
            flex: 1,
            minWidth: 0,
            padding: isMobile ? "12px" : "20px 24px",
            display: "flex",
            flexDirection: "column",
            height: "calc(100dvh - 64px)",
            boxSizing: "border-box",
            // Very short windows: scroll inside the channel, never the whole page
            overflowY: "auto"
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
              <div style={{ textAlign: "center", color: "var(--text-secondary)", marginTop: "40px" }}>
                {directMe ? (
                  "This person isn't in the workspace anymore."
                ) : (
                  <Spin />
                )}
              </div>
            ))}

          {activeChannelId &&
            (activeChannelInfo && directMe ? (
              <ChannelView
                key={activeChannelId}
                channel={activeChannelInfo}
                me={directMe}
                people={people}
                onLeft={(left) => {
                  // Private channels disappear once you leave; go back to #general
                  if (left.private || !channelList.some((c) => c.id === left.id)) {
                    setActiveChannel("general");
                  }
                }}
              />
            ) : (
              <div style={{ textAlign: "center", color: "var(--text-secondary)", marginTop: "40px" }}>
                {directMe && channelsLoaded ? (
                  <>
                    This channel isn&apos;t available anymore.{" "}
                    <Button type="link" onClick={() => setActiveChannel("general")}>
                      Go to #general
                    </Button>
                  </>
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
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      padding: isMobile ? "20px 16px" : "32px",
                      margin: isMobile ? "8px auto" : "20px auto",
                      maxWidth: "680px",
                      textAlign: "center",
                      boxShadow: "var(--shadow-md)"
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
                        color: "var(--text)",
                        marginBottom: "8px"
                      }}
                    >
                      Welcome to Slack AI Assistant!
                    </h3>
                    <p
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: "14px",
                        marginBottom: "24px"
                      }}
                    >
                      Ask questions, draft content, debug code, or brainstorm ideas right inside your workspace.
                    </p>

                    <div className="prompt-grid">
                      {SUGGESTED_PROMPTS.map((prompt, idx) => (
                        <button
                          type="button"
                          key={idx}
                          className="prompt-card"
                          onClick={() => handleSend(prompt.replace(/^[^\s]+\s/, ""))}
                          style={{ textAlign: "left", fontFamily: "inherit" }}
                        >
                          {prompt}
                        </button>
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
                          background: isUser ? "transparent" : "var(--surface)",
                          boxShadow: isUser ? "none" : "var(--shadow-sm)",
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
                                color: "var(--text)",
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
                                color: "var(--text-tertiary)"
                              }}
                            >
                              {message.time}
                            </span>
                          </div>

                          <div
                            style={{
                              fontSize: "14px",
                              lineHeight: "1.6",
                              color: "var(--text)",
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
                      background: "var(--surface)",
                      borderRadius: "8px",
                      boxShadow: "var(--shadow-sm)",
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
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
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

              {/* The assistant is for signed-in members (it spends AI credit) */}
              {!currentMemberId && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: "16px" }}
                  title="Sign in to use the AI assistant"
                  description="The assistant is available to workspace members. Sign in with your email in #general, then come back here."
                  action={
                    <Button size="small" onClick={() => setActiveChannel("general")}>
                      Go to #general
                    </Button>
                  }
                />
              )}

              {/* Slack-style Message Composer */}
              {currentMemberId && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "10px",
                    boxShadow: "var(--shadow-md)",
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
              )}
            </>
          )}
        </Content>
        <ThreadPanel me={directMe} people={people} isMobile={isMobile} />
        </div>
      </Layout>

      <HuddlePanel huddle={huddle} />

      <BrowseChannelsModal
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onOpenChannel={(id) => {
          setBrowseOpen(false);
          openChannel(`ch:${id}`);
        }}
        onCreate={() => {
          setBrowseOpen(false);
          setCreateOpen(true);
        }}
      />
      <CreateChannelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => openChannel(`ch:${created.id}`)}
      />
    </Layout>
  );
}

export default App;