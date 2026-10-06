import {
  createSlice,
  createAsyncThunk
} from "@reduxjs/toolkit";
import { apiRequest, SESSION_EXPIRED } from "../auth/session";
import { signOut } from "../general/generalSlice";

function apiThunk(type, callApi) {
  return createAsyncThunk(`direct/${type}`, async (arg, { rejectWithValue }) => {
    try {
      return await callApi(arg);
    } catch (err) {
      return rejectWithValue(err.message);
    }
  });
}

export const fetchConversations = apiThunk("fetchConversations", () =>
  apiRequest("/dm/conversations")
);

export const fetchDirectMessages = apiThunk(
  "fetchMessages",
  async ({ otherId }) => {
    const data = await apiRequest(`/dm/${encodeURIComponent(otherId)}/messages`);
    return { otherId, messages: data.messages };
  }
);

export const sendDirectMessage = apiThunk(
  "sendMessage",
  async ({ otherId, text }) => {
    const data = await apiRequest(`/dm/${encodeURIComponent(otherId)}/messages`, {
      method: "POST",
      body: { text }
    });
    return { otherId, message: data.message };
  }
);

export const markDirectRead = apiThunk("markRead", async ({ otherId }) => {
  await apiRequest(`/dm/${encodeURIComponent(otherId)}/read`, { method: "POST" });
  return { otherId };
});

const initialState = {
  // The signed-in member, as the server knows them
  me: null,
  conversations: [],
  messagesByMember: {},
  loadedMembers: {},
  error: null
};

const directSlice = createSlice({
  name: "direct",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchConversations.fulfilled, (state, action) => {
        state.me = action.payload.me;
        state.conversations = action.payload.conversations;
        state.error = null;
      })
      .addCase(fetchConversations.rejected, (state, action) => {
        state.error = action.payload;
      })
      .addCase(fetchDirectMessages.fulfilled, (state, action) => {
        const { otherId, messages } = action.payload;
        state.messagesByMember[otherId] = messages;
        state.loadedMembers[otherId] = true;
      })
      .addCase(sendDirectMessage.fulfilled, (state, action) => {
        const { otherId, message } = action.payload;
        const list = state.messagesByMember[otherId] || [];
        if (!list.some((m) => m.id === message.id)) list.push(message);
        state.messagesByMember[otherId] = list;
      })
      .addCase(markDirectRead.fulfilled, (state, action) => {
        const conversation = state.conversations.find(
          (c) => c.member.id === action.payload.otherId
        );
        if (conversation) conversation.unread = 0;
      })
      // Never show one person's DMs to the next person on this browser
      .addCase(signOut.fulfilled, () => initialState)
      .addMatcher(
        (action) => action.type.endsWith("/rejected") && action.payload === SESSION_EXPIRED,
        () => initialState
      );
  }
});

export default directSlice.reducer;
