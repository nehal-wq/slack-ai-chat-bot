import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
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

// Applies pushed chat events to the store, keeps unread counts and the tab
// title up to date, and shows desktop notifications for DMs and @mentions.
function useRealtimeSync({ currentMemberId, myName, activeChannel, openChannel }) {
  const dispatch = useDispatch();
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

    const unsubscribers = [
      subscribe("general:message", ({ message }) => {
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
      subscribe("general:messageUpdated", ({ message }) =>
        dispatch(generalMessageUpdated(message))
      ),
      subscribe("dm:messageUpdated", ({ message, members }) =>
        dispatch(directMessageUpdated({ message, members, myId: currentMemberId }))
      ),
      // Other channels
      subscribe("channel:message", ({ channelId, message }) => {
        dispatch(channelMessageReceived(message));
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
      subscribe("channel:messageUpdated", ({ message }) =>
        dispatch(channelMessageUpdated(message))
      ),
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
  }, [dispatch, currentMemberId]);

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
