import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { subscribe } from "./realtimeBus";
import {
  fetchGeneral,
  generalMessageReceived,
  generalMessageUpdated,
  presenceChanged,
  generalUnseenAdded,
  generalSeen
} from "../general/generalSlice";
import {
  fetchConversations,
  directMessageReceived,
  directMessageUpdated
} from "../direct/directSlice";
import {
  fetchChannels,
  channelMessageReceived,
  channelMessageUpdated,
  channelUnseenAdded,
  channelSeen
} from "../channels/channelsSlice";
import { threadOpened, threadMessageReceived } from "../threads/threadsSlice";
import { showNotification } from "../notifications/notify";

const APP_TITLE = "Slack AI Workspace";

function mentions(text, name) {
  if (!text || !name) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes(`@${name.toLowerCase()}`) ||
    /@(channel|everyone|here)\b/.test(lower)
  );
}

// Finds a message we already have (thread panel or any loaded feed)
function findLoadedMessage(state, id) {
  const lists = [
    state.general.messages,
    ...Object.values(state.channels.messagesById),
    ...Object.values(state.direct.messagesByMember)
  ];
  return (
    state.threads.byParent[id]?.parent ||
    lists.reduce((found, list) => found || list.find((m) => m.id === id), null)
  );
}

// Applies pushed chat events to the store, keeps unread counts and the tab
// title up to date, and shows desktop notifications for DMs and @mentions.
function useRealtimeSync({ currentMemberId, myName, activeChannel, openChannel }) {
  const dispatch = useDispatch();
  const store = useStore();
  const unseenGeneral = useSelector((state) => state.general.unseenCount);
  const unreadDirect = useSelector((state) =>
    state.direct.conversations.reduce((total, c) => total + (c.unread || 0), 0)
  );
  const unseenChannels = useSelector((state) =>
    Object.values(state.channels.unseen).reduce((total, n) => total + n, 0)
  );
  const channelList = useSelector((state) => state.channels.list);

  // Handlers read the latest values without re-subscribing
  const latest = useRef({});
  useEffect(() => {
    latest.current = { currentMemberId, myName, activeChannel, openChannel, channelList };
  });

  useEffect(() => {
    if (!currentMemberId) return undefined;
    const isLookingAt = (channel) =>
      !document.hidden && latest.current.activeChannel === channel;

    // A thread reply: never counts as unread in the conversation, but tells
    // you when someone replies to a thread you're in, or mentions you there
    const handleReply = (message, { kind, convId = null, where }) => {
      dispatch(threadMessageReceived(message));
      if (message.type !== "user" || message.memberId === currentMemberId) return;
      const state = store.getState();
      if (!document.hidden && state.threads.open?.parentId === message.parentId) return;
      const parent = findLoadedMessage(state, message.parentId);
      const involved =
        parent &&
        (parent.memberId === currentMemberId || (parent.replyMemberIds || []).includes(currentMemberId));
      if (!involved && !mentions(message.text, latest.current.myName)) return;
      showNotification({
        title: `${message.author} replied in a thread${where}`,
        body: message.text,
        tag: `thread-${message.parentId}`,
        onClick: () => {
          latest.current.openChannel(kind === "channel" ? `ch:${convId}` : kind === "dm" ? `dm:${convId}` : "general");
          dispatch(threadOpened({ kind, convId, parentId: message.parentId }));
        }
      });
    };

    const unsubscribers = [
      subscribe("general:message", ({ message }) => {
        if (message.parentId) return handleReply(message, { kind: "general", where: " in #general" });
        dispatch(generalMessageReceived(message));
        const fromSomeoneElse = message.type !== "system" && message.memberId !== currentMemberId;
        if (!fromSomeoneElse || isLookingAt("general")) return;
        dispatch(generalUnseenAdded());
        if (message.type === "user" && mentions(message.text, latest.current.myName)) {
          showNotification({
            title: `${message.author} mentioned you in #general`,
            body: message.text,
            tag: "general-mention",
            onClick: () => latest.current.openChannel("general")
          });
        }
      }),
      subscribe("general:changed", () => {
        dispatch(fetchGeneral());
        dispatch(fetchConversations());
      }),
      subscribe("dm:message", ({ message, members }) => {
        if (message.parentId) {
          const otherId = members.find((id) => id !== currentMemberId);
          return handleReply(message, { kind: "dm", convId: otherId, where: "" });
        }
        dispatch(directMessageReceived({ message, members, myId: currentMemberId }));
        const fromOther = message.type === "user" && message.memberId !== currentMemberId;
        if (fromOther && !isLookingAt(`dm:${message.memberId}`)) {
          showNotification({
            title: message.author,
            body: message.text,
            tag: `dm-${message.memberId}`,
            onClick: () => latest.current.openChannel(`dm:${message.memberId}`)
          });
        }
      }),
      // Someone edited, deleted or reacted to a message
      subscribe("general:messageUpdated", ({ message }) => {
        dispatch(generalMessageUpdated(message));
        dispatch(threadMessageReceived(message));
      }),
      subscribe("dm:messageUpdated", ({ message, members }) => {
        dispatch(directMessageUpdated({ message, members, myId: currentMemberId }));
        dispatch(threadMessageReceived(message));
      }),
      // Other channels
      subscribe("channel:message", ({ channelId, message }) => {
        if (message.parentId) {
          const id = channelId || message.channel;
          const name = latest.current.channelList.find((c) => c.id === id)?.name;
          return handleReply(message, { kind: "channel", convId: id, where: name ? ` in #${name}` : "" });
        }
        dispatch(channelMessageReceived({ channelId, message }));
        const fromSomeoneElse = message.type !== "system" && message.memberId !== currentMemberId;
        const info = latest.current.channelList.find((c) => c.id === (channelId || message.channel));
        if (!fromSomeoneElse || !info?.joined || isLookingAt(`ch:${info.id}`)) return;
        dispatch(channelUnseenAdded(info.id));
        if (message.type === "user" && mentions(message.text, latest.current.myName)) {
          showNotification({
            title: `${message.author} mentioned you in #${info.name}`,
            body: message.text,
            tag: `channel-mention-${info.id}`,
            onClick: () => latest.current.openChannel(`ch:${info.id}`)
          });
        }
      }),
      subscribe("channel:messageUpdated", ({ channelId, message }) => {
        dispatch(channelMessageUpdated({ channelId, message }));
        dispatch(threadMessageReceived(message));
      }),
      subscribe("channels:changed", () => dispatch(fetchChannels())),
      subscribe("presence", ({ online }) => dispatch(presenceChanged(online))),
      // After (re)connecting, catch up on anything missed while offline
      subscribe("realtime:connected", () => {
        dispatch(fetchGeneral());
        dispatch(fetchConversations());
        dispatch(fetchChannels());
      })
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [dispatch, store, currentMemberId]);

  // Looking at #general (with the tab visible) clears its unseen count
  useEffect(() => {
    const markSeen = () => {
      if (document.hidden) return;
      const active = latest.current.activeChannel;
      if (active === "general") dispatch(generalSeen());
      if (active.startsWith("ch:")) dispatch(channelSeen(active.slice(3)));
    };
    markSeen();
    document.addEventListener("visibilitychange", markSeen);
    return () => document.removeEventListener("visibilitychange", markSeen);
  }, [dispatch, activeChannel]);

  // "(3) Slack AI Workspace" when there's something unread
  useEffect(() => {
    const total = currentMemberId ? unseenGeneral + unreadDirect + unseenChannels : 0;
    document.title = total ? `(${total}) ${APP_TITLE}` : APP_TITLE;
  }, [currentMemberId, unseenGeneral, unreadDirect, unseenChannels]);
}

export default useRealtimeSync;
