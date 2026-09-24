import {
  createSlice,
  createAsyncThunk
} from "@reduxjs/toolkit";

const initialState = {
  messages: [],
  loading: false,
  error: null
};

export const sendMessage = createAsyncThunk(
  "chat/sendMessage",
  async ({ message, history }) => {
    const response = await fetch(
      "http://localhost:5000/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: message,
          history: history
        })
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get AI response");
    }

    const data = await response.json();

    return data;
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
    }
  },

  extraReducers: (builder) => {
    builder.addCase(
      sendMessage.pending,
      (state) => {
        state.loading = true;
        state.error = null;
      }
    );

    builder.addCase(
      sendMessage.fulfilled,
      (state, action) => {
        state.loading = false;

        state.messages.push({
          sender: "ai",
          text: action.payload.reply
        });
      }
    );

    builder.addCase(
      sendMessage.rejected,
      (state, action) => {
        state.loading = false;

        state.error =
          action.error.message ||
          "Unable to connect to the AI server.";
      }
    );
  }
});

export const {
  addMessage,
  clearMessages
} = chatSlice.actions;

export default chatSlice.reducer;