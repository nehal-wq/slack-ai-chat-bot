import {
  createSlice,
  createAsyncThunk
} from "@reduxjs/toolkit";
import { apiRequest } from "../auth/session";

const initialState = {
  messages: [],
  loading: false,
  error: null
};

// The AI assistant is for signed-in members (it spends OpenRouter credit),
// so requests carry the session like every other API call
export const sendMessage = createAsyncThunk(
  "chat/sendMessage",
  async ({ message, history }, { rejectWithValue }) => {
    try {
      return await apiRequest("/chat", { method: "POST", body: { message, history } });
    } catch (err) {
      return rejectWithValue(err.message || "Failed to get AI response");
    }
  }
);

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    addMessage: (state, action) => {
      state.messages.push(action.payload);
    },
    clearMessages: (state) => {
      state.messages = [];
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(sendMessage.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(sendMessage.fulfilled, (state, action) => {
        state.loading = false;
        state.messages.push({
          sender: "ai",
          text: action.payload.reply,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })
        });
      })
      .addCase(sendMessage.rejected, (state, action) => {
        state.loading = false;
        state.error =
          action.payload ||
          action.error.message ||
          "Unable to connect to the AI server.";
      });
  }
});

export const {
  addMessage,
  clearMessages
} = chatSlice.actions;

export default chatSlice.reducer;