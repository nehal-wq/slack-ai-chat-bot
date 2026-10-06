import {
  createSlice,
  createAsyncThunk
} from "@reduxjs/toolkit";
import {
  apiRequest,
  getSessionToken,
  setSessionToken,
  SESSION_EXPIRED
} from "../auth/session";

function apiThunk(type, callApi) {
  return createAsyncThunk(`general/${type}`, async (arg, { rejectWithValue }) => {
    try {
      return await callApi(arg);
    } catch (err) {
      return rejectWithValue(err.message);
    }
  });
}

// --- Sign-in ---

// Who the stored session belongs to
export const fetchMe = apiThunk("fetchMe", () => apiRequest("/auth/me"));

// Emails a one-time sign-in link
export const requestLogin = apiThunk("requestLogin", ({ email, name }) =>
  apiRequest("/auth/request", { method: "POST", body: { email, name } })
);

// Exchanges the emailed link's token for a session
export const verifyLogin = apiThunk("verifyLogin", async (token) => {
  const data = await apiRequest("/auth/verify", { method: "POST", body: { token } });
  setSessionToken(data.sessionToken);
  return data;
});

// The page that asked for a link checks whether it was clicked anywhere
// (another browser, a phone) and collects its own session when it was
export const pollLogin = apiThunk("pollLogin", async (requestId) => {
  const data = await apiRequest("/auth/poll", { method: "POST", body: { requestId } });
  if (data.sessionToken) setSessionToken(data.sessionToken);
  return data;
});

export const signOut = createAsyncThunk("general/signOut", async () => {
  await apiRequest("/auth/logout", { method: "POST" }).catch(() => {});
  setSessionToken(null);
});

// --- #general ---

export const fetchGeneral = apiThunk("fetch", () => apiRequest("/general/state"));

export const fetchInvite = apiThunk("fetchInvite", (token) =>
  apiRequest(`/general/invites/${encodeURIComponent(token)}`)
);

// The invite link proves the email, so accepting signs you in
export const acceptInvite = apiThunk("acceptInvite", async ({ token, name }) => {
  const data = await apiRequest(`/general/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: { name }
  });
  setSessionToken(data.sessionToken);
  return data;
});

export const inviteMember = apiThunk("invite", ({ email, name }) =>
  apiRequest("/general/invites", { method: "POST", body: { email, name } })
);

export const removeMember = apiThunk("removeMember", ({ memberId }) =>
  apiRequest(`/general/members/${memberId}`, { method: "DELETE" })
);

export const makeOwner = apiThunk("makeOwner", ({ memberId }) =>
  apiRequest(`/general/members/${memberId}/make-owner`, { method: "POST" })
);

// Owner-only workspace settings, e.g. { membersCanInvite: true }
export const updateSettings = apiThunk("updateSettings", (changes) =>
  apiRequest("/general/settings", { method: "PATCH", body: changes })
);

export const postGeneralMessage = apiThunk("postMessage", ({ text }) =>
  apiRequest("/general/messages", { method: "POST", body: { text } })
);

const initialState = {
  members: [],
  messages: [],
  emailEnabled: false,
  settings: { membersCanInvite: false },
  loaded: false,
  error: null,
  // Set once the server confirms who the stored session belongs to
  currentMemberId: null,
  hasSession: Boolean(getSessionToken()),
  authChecked: false,
  sessionExpired: false,
  loginError: null
};

function addMemberToState(state, member) {
  const index = state.members.findIndex((m) => m.id === member.id);
  if (index === -1) {
    state.members.push(member);
  } else {
    state.members[index] = member;
  }
}

function signIn(state, member) {
  addMemberToState(state, member);
  state.currentMemberId = member.id;
  state.hasSession = true;
  state.authChecked = true;
  state.sessionExpired = false;
  state.loginError = null;
}

function signedOut(state) {
  state.currentMemberId = null;
  state.hasSession = false;
  state.authChecked = true;
  state.members = [];
  state.messages = [];
  state.loaded = false;
  state.error = null;
}

const generalSlice = createSlice({
  name: "general",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMe.fulfilled, (state, action) => {
        signIn(state, action.payload.member);
      })
      .addCase(fetchMe.rejected, (state) => {
        // Server unreachable: keep the session and retry later
        state.authChecked = !state.hasSession;
      })
      .addCase(verifyLogin.fulfilled, (state, action) => {
        signIn(state, action.payload.member);
      })
      .addCase(pollLogin.fulfilled, (state, action) => {
        if (action.payload.member) signIn(state, action.payload.member);
      })
      .addCase(verifyLogin.rejected, (state, action) => {
        state.loginError = action.payload;
      })
      .addCase(signOut.fulfilled, (state) => {
        signedOut(state);
        state.sessionExpired = false;
      })
      .addCase(fetchGeneral.fulfilled, (state, action) => {
        state.members = action.payload.members;
        state.messages = action.payload.messages;
        state.emailEnabled = action.payload.emailEnabled;
        state.settings = action.payload.settings;
        state.loaded = true;
        state.error = null;
      })
      .addCase(fetchGeneral.rejected, (state, action) => {
        state.loaded = true;
        state.error = action.payload;
      })
      .addCase(acceptInvite.fulfilled, (state, action) => {
        signIn(state, action.payload.member);
      })
      .addCase(inviteMember.fulfilled, (state, action) => {
        addMemberToState(state, action.payload.member);
      })
      .addCase(removeMember.fulfilled, (state, action) => {
        const { removedId } = action.payload;
        state.members = state.members.filter((m) => m.id !== removedId);
        if (removedId === state.currentMemberId) {
          setSessionToken(null);
          signedOut(state);
        }
      })
      .addCase(updateSettings.fulfilled, (state, action) => {
        state.settings = action.payload.settings;
      })
      .addCase(makeOwner.fulfilled, (state, action) => {
        state.members = action.payload.members;
      })
      .addCase(postGeneralMessage.fulfilled, (state, action) => {
        const { message } = action.payload;
        if (!state.messages.some((m) => m.id === message.id)) {
          state.messages.push(message);
        }
      })
      // Any request (here or in DMs) that finds the session invalid signs out
      .addMatcher(
        (action) => action.type.endsWith("/rejected") && action.payload === SESSION_EXPIRED,
        (state) => {
          if (state.hasSession) state.sessionExpired = true;
          signedOut(state);
        }
      );
  }
});

export default generalSlice.reducer;
