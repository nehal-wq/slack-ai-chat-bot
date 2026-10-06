import { configureStore } from "@reduxjs/toolkit";
import chatReducer from "../features/chat/chatSlice";
import generalReducer from "../features/general/generalSlice";
import directReducer from "../features/direct/directSlice";

const store = configureStore({
  reducer: {
    chat: chatReducer,
    general: generalReducer,
    direct: directReducer
  }
});

export default store;