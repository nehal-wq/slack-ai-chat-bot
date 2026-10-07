import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiRequest, SESSION_EXPIRED } from "../auth/session";
import { signOut } from "../general/generalSlice";
import {
  mergeLatest,
  hasOlderThan,
  prependOlder,
  replaceMessage
} from "../messages/mergeMessages";

// Channels beyond #general: the list you can see, and each channel's
// messages (loaded when opened, then kept up to date by realtime pushes).

function apiThunk(type, callApi) {
  return createAsyncThunk(`channels/${type}`, async (arg, { rejectWithValue }) => {
    try {
      return await callApi(arg);
    } catch (err) {
      return rejectWithValue(err.message);
    }
  });
}

const path = (id, rest = "") => `/channels/${encodeURIComponent(id)}${rest}`;

export const fetchChannels = apiThunk("fetch", () => apiRequest("/channels"));

export const createChannel = apiThunk("create", (body) =>
  apiRequest("/channels", { method: "POST", body })
);

export const joinChannel = apiThunk("join", (id) =>
  apiRequest(path(id, "/join"), { method: "POST" })
);

export const leaveChannel = apiThunk("leave", (id) =>
  apiRequest(path(id, "/leave"), { method: "POST" })
);

export const addChannelMember = apiThunk("addMember", ({ id, memberId }) =>
  apiRequest(path(id, "/members"), { method: "POST", body: { memberId } })
);

export const setChannelTopic = apiThunk("setTopic", ({ id, topic }) =>
  apiRequest(path(id), { method: "PATCH", body: { topic } })
);

export const deleteChannel = apiThunk("delete", (id) =>
  apiRequest(path(id), { method: "DELETE" })
);

export const fetchChannelMessages = apiThunk("fetchMessages", async (id) => {
  const data = await apiRequest(path(id, "/messages"));
  return { id, ...data };
});

export const fetchOlderChannel = apiThunk("fetchOlder", async ({ id, before }) => {
  const data = await apiRequest(path(id, `/messages?before=${encodeURIComponent(before)}`));
  return { id, ...data };
});

export const postChannelMessage = apiThunk("postMessage", async ({ id, text }) => {
  const data = await apiRequest(path(id, "/messages"), { method: "POST", body: { text } });
  return { id, message: data.message };
});

export const editChannelMessage = apiThunk("editMessage", async ({ id, messageId, text }) => {
  const data = await apiRequest(path(id, `/messages/${messageId}`), {
    method: "PATCH",
    body: { text }
  });
  return { id, message: data.message };
});

export const deleteChannelMessage = apiThunk("deleteMessage", async ({ id, messageId }) => {
  const data = await apiRequest(path(id, `/messages/${messageId}`), { method: "DELETE" });
  return { id, message: data.message };
});

export const reactChannelMessage = apiThunk("react", async ({ id, messageId, emoji }) => {
  const data = await apiRequest(path(id, `/messages/${messageId}/reactions`), {
    method: "POST",
    body: { emoji }
  });
  return { id, message: data.message };
});

const initialState = {
  list: [],
  listLoaded: false,
  messagesById: {},
  loadedById: {},
  hasMoreById: {},
  loadingOlderById: {},
  // Messages that arrived in a channel while you weren't looking at it
  unseen: {}
};

function upsertChannel(state, channel) {
  const index = state.list.findIndex((c) => c.id === channel.id);
  if (index === -1) state.list.push(channel);
  else state.list[index] = channel;
  state.list.sort((a, b) => a.name.localeCompare(b.name));
}

function addMessage(state, id, message) {
  const list = state.messagesById[id];
  if (list && !list.some((m) => m.id === message.id)) list.push(message);
}

const channelsSlice = createSlice({
  name: "channels",
  initialState,
  reducers: {
    channelMessageReceived: (state, action) => {
      addMessage(state, action.payload.channelId, action.payload.message);
    },
    channelMessageUpdated: (state, action) => {
      const list = state.messagesById[action.payload.channelId];
      if (list) replaceMessage(list, action.payload.message);
    },
    channelUnseenAdded: (state, action) => {
      state.unseen[action.payload] = (state.unseen[action.payload] || 0) + 1;
    },
    channelSeen: (state, action) => {
      delete state.unseen[action.payload];
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchChannels.fulfilled, (state, action) => {
        state.list = action.payload.channels;
        state.listLoaded = true;
        // Forget unread counts for channels you can no longer see or left
        const joined = new Set(state.list.filter((c) => c.joined).map((c) => c.id));
        for (const id of Object.keys(state.unseen)) {
          if (!joined.has(id)) delete state.unseen[id];
        }
      })
      .addCase(deleteChannel.fulfilled, (state, action) => {
        state.list = state.list.filter((c) => c.id !== action.payload.deletedId);
      })
      .addCase(fetchChannelMessages.fulfilled, (state, action) => {
        const { id, messages, hasMore } = action.payload;
        const existing = state.messagesById[id] || [];
        if (!hasOlderThan(existing, messages)) state.hasMoreById[id] = hasMore;
        state.messagesById[id] = mergeLatest(existing, messages);
        state.loadedById[id] = true;
      })
      .addCase(fetchOlderChannel.pending, (state, action) => {
        state.loadingOlderById[action.meta.arg.id] = true;
      })
      .addCase(fetchOlderChannel.fulfilled, (state, action) => {
        const { id, messages, hasMore } = action.payload;
        state.loadingOlderById[id] = false;
        state.messagesById[id] = prependOlder(state.messagesById[id] || [], messages);
        state.hasMoreById[id] = hasMore;
      })
      .addCase(fetchOlderChannel.rejected, (state, action) => {
        state.loadingOlderById[action.meta.arg.id] = false;
      })
      .addCase(postChannelMessage.fulfilled, (state, action) => {
        addMessage(state, action.payload.id, action.payload.message);
      })
      .addCase(signOut.fulfilled, () => initialState)
      // Channel changes (create/join/leave/add/topic) return the updated channel
      .addMatcher(
        (action) =>
          [createChannel, joinChannel, leaveChannel, addChannelMember, setChannelTopic].some(
            (thunk) => thunk.fulfilled.match(action)
          ),
        (state, action) => {
          upsertChannel(state, action.payload.channel);
        }
      )
      .addMatcher(
        (action) =>
          [editChannelMessage, deleteChannelMessage, reactChannelMessage].some((thunk) =>
            thunk.fulfilled.match(action)
          ),
        (state, action) => {
          const list = state.messagesById[action.payload.id];
          if (list) replaceMessage(list, action.payload.message);
        }
      )
      .addMatcher(
        (action) => action.type.endsWith("/rejected") && action.payload === SESSION_EXPIRED,
        () => initialState
      );
  }
});

export const { channelMessageReceived, channelMessageUpdated, channelUnseenAdded, channelSeen } =
  channelsSlice.actions;

export default channelsSlice.reducer;
