import {
  createSlice,
  createAsyncThunk
} from "@reduxjs/toolkit";
import { API_BASE } from "../../config";

const initialState = {
  messages: [],
  loading: false,
  error: null
};

export const sendMessage = createAsyncThunk(
  "chat/sendMessage",
  async ({ message, history }, { rejectWithValue }) => {
    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: message,
          history: history
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return rejectWithValue(data.error || "Failed to get AI response");
      }

      return data;
    } catch {
      return rejectWithValue(
        "Unable to connect to the AI server. Make sure the backend is running on port 5000."
      );
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