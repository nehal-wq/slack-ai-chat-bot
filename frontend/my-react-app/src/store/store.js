import { configureStore } from "@reduxjs/toolkit";
import chatReducer from "../features/chat/chatSlice";
import generalReducer from "../features/general/generalSlice";
import directReducer from "../features/direct/directSlice";
import channelsReducer from "../features/channels/channelsSlice";
import threadsReducer from "../features/threads/threadsSlice";

const store = configureStore({
  reducer: {
    chat: chatReducer,
    general: generalReducer,
    direct: directReducer,
    channels: channelsReducer,
    threads: threadsReducer
  }
});

export default store;