import { createSlice, createAsyncThunk, isAnyOf } from "@reduxjs/toolkit";
import { apiRequest, SESSION_EXPIRED } from "../auth/session";
import { signOut, generalMessageUpdated } from "../general/generalSlice";
import { channelMessageUpdated } from "../channels/channelsSlice";
import { directMessageUpdated } from "../direct/directSlice";
import { replaceMessage } from "../messages/mergeMessages";

// Threads: replies to one message, shown in a side panel. A thread lives in
// #general (kind "general"), a channel (kind "channel", convId = channel id)
// or a DM (kind "dm", convId = the other person's id).

function messagesPath(kind, convId) {
  if (kind === "channel") return `/channels/${encodeURIComponent(convId)}/messages`;
  if (kind === "dm") return `/dm/${encodeURIComponent(convId)}/messages`;
  return "/general/messages";
}

// The sidebar view key a thread belongs to ("general", "ch:<id>", "dm:<id>")
export function threadViewKey({ kind, convId }) {
  if (kind === "channel") return `ch:${convId}`;
  if (kind === "dm") return `dm:${convId}`;
  return "general";
}

// Keeps the reply count under the message in the main feed up to date
// (realtime pushes do this too; this covers a dropped connection)
function syncParent(dispatch, getState, { kind, convId }, parent) {
  if (!parent) return;
  if (kind === "channel") dispatch(channelMessageUpdated({ channelId: convId, message: parent }));
  else if (kind === "general") dispatch(generalMessageUpdated(parent));
  else {
    const myId = getState().direct.me?.id;
    if (myId) dispatch(directMessageUpdated({ message: parent, members: [myId, convId], myId }));
  }
}

function threadThunk(type, callApi) {
  return createAsyncThunk(`threads/${type}`, async (arg, thunkApi) => {
    try {
      return await callApi(arg, thunkApi);
    } catch (err) {
      return thunkApi.rejectWithValue(err.message);
    }
  });
}

export const fetchThread = threadThunk("fetch", ({ kind, convId, parentId }) =>
  apiRequest(`${messagesPath(kind, convId)}/${parentId}/replies`)
);

export const postReply = threadThunk(
  "postReply",
  async ({ kind, convId, parentId, text }, { dispatch, getState }) => {
    const data = await apiRequest(`${messagesPath(kind, convId)}/${parentId}/replies`, {
      method: "POST",
      body: { text }
    });
    syncParent(dispatch, getState, { kind, convId }, data.parent);
    return data;
  }
);

// Edit, delete and react reuse the normal message routes. Changing the
// parent from the panel also updates its copy in the main feed.
function changeThunk(type, request) {
  return threadThunk(type, async (arg, { dispatch, getState }) => {
    const data = await apiRequest(...request(arg));
    if (!data.message.parentId) syncParent(dispatch, getState, arg, data.message);
    return data;
  });
}

export const editThreadMessage = changeThunk("edit", ({ kind, convId, messageId, text }) => [
  `${messagesPath(kind, convId)}/${messageId}`,
  { method: "PATCH", body: { text } }
]);

export const deleteThreadMessage = changeThunk("delete", ({ kind, convId, messageId }) => [
  `${messagesPath(kind, convId)}/${messageId}`,
  { method: "DELETE" }
]);

export const reactThreadMessage = changeThunk("react", ({ kind, convId, messageId, emoji }) => [
  `${messagesPath(kind, convId)}/${messageId}/reactions`,
  { method: "POST", body: { emoji } }
]);

const initialState = {
  // { kind, convId, parentId } of the thread in the side panel, or null
  open: null,
  // parentId -> { parent, replies, loaded }
  byParent: {}
};

function entryFor(state, parentId) {
  state.byParent[parentId] ??= { parent: null, replies: [], loaded: false };
  return state.byParent[parentId];
}

// A new or changed message: the parent of a thread, or one of its replies
function applyMessage(state, message) {
  const asParent = state.byParent[message.id];
  if (asParent) asParent.parent = message;
  if (message.parentId && state.byParent[message.parentId]) {
    const { replies } = state.byParent[message.parentId];
    if (replies.some((m) => m.id === message.id)) replaceMessage(replies, message);
    else replies.push(message);
  }
}

const threadsSlice = createSlice({
  name: "threads",
  initialState,
  reducers: {
    threadOpened: (state, action) => {
      const { kind, convId = null, parentId, parent } = action.payload;
      state.open = { kind, convId, parentId };
      const entry = entryFor(state, parentId);
      if (parent && !entry.parent) entry.parent = parent;
    },
    threadClosed: (state) => {
      state.open = null;
    },
    // Pushed replies and edits/deletes/reactions, for threads we've loaded
    threadMessageReceived: (state, action) => {
      applyMessage(state, action.payload);
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchThread.fulfilled, (state, action) => {
        const entry = entryFor(state, action.meta.arg.parentId);
        entry.parent = action.payload.parent;
        // Keep anything pushed while loading
        const loadedIds = new Set(action.payload.replies.map((m) => m.id));
        const pushed = entry.replies.filter((m) => !loadedIds.has(m.id));
        entry.replies = [...action.payload.replies, ...pushed];
        entry.loaded = true;
      })
      .addCase(postReply.fulfilled, (state, action) => {
        entryFor(state, action.meta.arg.parentId);
        applyMessage(state, action.payload.parent);
        applyMessage(state, action.payload.message);
      })
      .addCase(signOut.fulfilled, () => initialState)
      .addMatcher(
        isAnyOf(editThreadMessage.fulfilled, deleteThreadMessage.fulfilled, reactThreadMessage.fulfilled),
        (state, action) => applyMessage(state, action.payload.message)
      )
      .addMatcher(
        (action) => action.type.endsWith("/rejected") && action.payload === SESSION_EXPIRED,
        () => initialState
      );
  }
});

export const { threadOpened, threadClosed, threadMessageReceived } = threadsSlice.actions;

export default threadsSlice.reducer;
