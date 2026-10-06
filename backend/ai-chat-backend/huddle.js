const { WebSocketServer } = require("ws");

// Call signaling for #general huddles and 1:1 direct calls.
// Media flows peer-to-peer over WebRTC; this server only tracks who is in
// which call and relays offers, answers and ICE candidates between them.
//
// Rooms:
//   "general"         the #general huddle (up to 6 people, rings everyone)
//   "dm:<idA>:<idB>"  a direct call between two members (ids sorted)

const GENERAL_ROOM = "general";
const MAX_GENERAL_PARTICIPANTS = 6; // full mesh: every participant connects to every other
const HEARTBEAT_MS = 15000;
// Membership is re-checked at most this often per connection (not per message)
const MEMBER_RECHECK_MS = 10000;

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function attachHuddleServer(
  server,
  { findJoinedMember, memberFromToken, addSystemMessage, addDirectSystemMessage, isAllowedOrigin }
) {
  const wss = new WebSocketServer({ server, path: "/ws/huddle" });

  // Fire-and-forget writes (call history) must never crash the server
  function logFailure(error) {
    console.error("HUDDLE ERROR:", error.message || error);
  }

  // roomId -> { participants: Map<memberId, participant>, startedAt, startedBy, video, answered, declined }
  const rooms = new Map();
  // memberId -> roomId (a member can be in one call at a time)
  const memberRoom = new Map();

  // Who may join a room, and how big it can get
  async function describeRoom(roomId, memberId) {
    if (roomId === GENERAL_ROOM) {
      return { kind: "general", max: MAX_GENERAL_PARTICIPANTS };
    }
    const match = /^dm:([^:]+):([^:]+)$/.exec(roomId || "");
    if (!match) return null;
    const [, a, b] = match;
    if (a >= b || (memberId !== a && memberId !== b)) return null;
    const otherId = memberId === a ? b : a;
    if (!(await findJoinedMember(otherId))) return null;
    return { kind: "dm", max: 2, members: [a, b], otherId };
  }

  function canSee(memberId, roomId) {
    return roomId === GENERAL_ROOM || roomId.split(":").slice(1).includes(memberId);
  }

  function snapshot(room) {
    return {
      startedAt: room.startedAt,
      startedBy: room.startedBy,
      participants: [...room.participants.values()].map(({ socket, ...p }) => p)
    };
  }

  function send(socket, message) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function socketsOf(memberId) {
    return [...wss.clients].filter((client) => client.memberId === memberId);
  }

  // Each client only learns about #general and its own direct calls
  function sendState(socket) {
    const visible = {};
    for (const [roomId, room] of rooms) {
      if (canSee(socket.memberId, roomId)) visible[roomId] = snapshot(room);
    }
    send(socket, { type: "rooms", rooms: visible });
  }

  function broadcastState() {
    for (const client of wss.clients) {
      // Only signed-in connections hear about calls
      if (client.memberId) sendState(client);
    }
  }

  function endRoom(roomId, room) {
    rooms.delete(roomId);
    const duration = formatDuration(Date.now() - room.startedAt);

    if (roomId === GENERAL_ROOM) {
      addSystemMessage(`Huddle ended · lasted ${duration}`).catch(logFailure);
      return;
    }

    const [, a, b] = roomId.split(":");
    const kind = room.video ? "video call" : "call";
    let text;
    if (room.answered) text = `📞 ${kind[0].toUpperCase()}${kind.slice(1)} ended · lasted ${duration}`;
    else if (room.declined) text = `📞 ${room.startedBy}'s ${kind} was declined`;
    else text = `📞 Missed ${kind} from ${room.startedBy}`;
    addDirectSystemMessage(a, b, text).catch(logFailure);
  }

  function leave(memberId) {
    const roomId = memberRoom.get(memberId);
    const room = roomId && rooms.get(roomId);
    memberRoom.delete(memberId);
    if (!room || !room.participants.delete(memberId)) return;
    if (room.participants.size === 0) endRoom(roomId, room);
    broadcastState();
  }

  async function handleJoin(socket, member, message) {
    const roomId = message.room || GENERAL_ROOM;
    const info = await describeRoom(roomId, member.id);

    const currentRoom = memberRoom.get(member.id);
    if (currentRoom) {
      const existing = rooms.get(currentRoom)?.participants.get(member.id);
      if (existing?.socket !== socket || currentRoom !== roomId) {
        send(socket, {
          type: "error",
          error:
            existing?.socket !== socket
              ? "You're already in a call in another tab."
              : "Leave your current call first."
        });
      }
      return;
    }

    if (!info) {
      send(socket, { type: "error", error: "You can't join that call." });
      return;
    }

    let room = rooms.get(roomId);
    if (room && room.participants.size >= info.max) {
      send(socket, {
        type: "error",
        error:
          info.kind === "dm"
            ? "That call is already in progress."
            : `Huddles are limited to ${info.max} people.`
      });
      return;
    }

    const isNew = !room;
    if (isNew) {
      room = {
        participants: new Map(),
        startedAt: Date.now(),
        startedBy: member.name,
        video: Boolean(message.video),
        answered: false,
        declined: false
      };
      rooms.set(roomId, room);
    } else if (info.kind === "dm") {
      room.answered = true;
    }

    const peers = [...room.participants.keys()];
    room.participants.set(member.id, {
      memberId: member.id,
      name: member.name,
      audio: Boolean(message.audio),
      video: Boolean(message.video),
      joinedAt: Date.now(),
      socket
    });
    memberRoom.set(member.id, roomId);

    if (isNew) {
      const ring = {
        type: "ring",
        room: roomId,
        from: member.name,
        video: Boolean(message.video),
        direct: info.kind === "dm"
      };
      if (info.kind === "general") {
        addSystemMessage(
          `${member.name} started ${message.video ? "a video" : "an audio"} huddle`
        ).catch(logFailure);
        // Ring everyone else who is online
        for (const client of wss.clients) {
          if (client.memberId && client.memberId !== member.id) send(client, ring);
        }
      } else {
        // Ring only the person being called
        for (const client of socketsOf(info.otherId)) send(client, ring);
      }
    }

    // The newcomer calls everyone already in the room
    send(socket, { type: "joined", room: roomId, peers });
    broadcastState();
  }

  async function handleDecline(member, message) {
    const roomId = message.room;
    const info = rooms.has(roomId) && (await describeRoom(roomId, member.id));
    const room = rooms.get(roomId);
    if (!info || !room || info.kind !== "dm" || room.participants.has(member.id)) return;
    room.declined = true;
    for (const participant of room.participants.values()) {
      send(participant.socket, { type: "declined", room: roomId, by: member.name });
    }
  }

  // The member behind a socket, re-checked against the database now and then
  // (people can be removed from the workspace mid-session)
  async function currentMember(socket) {
    if (Date.now() - socket.memberCheckedAt > MEMBER_RECHECK_MS) {
      socket.member = await findJoinedMember(socket.memberId);
      socket.memberCheckedAt = Date.now();
    }
    return socket.member;
  }

  async function handleMessage(socket, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const current = await currentMember(socket);
    if (!current) {
      socket.close(4001, "Not a member of #general");
      return;
    }

    const roomId = memberRoom.get(current.id);
    const self = roomId && rooms.get(roomId)?.participants.get(current.id);
    const isSelf = self && self.socket === socket;

    switch (message.type) {
      case "join":
        await handleJoin(socket, current, message);
        break;
      case "leave":
        if (isSelf) leave(current.id);
        break;
      case "decline":
        await handleDecline(current, message);
        break;
      case "media":
        if (isSelf) {
          self.audio = Boolean(message.audio);
          self.video = Boolean(message.video);
          broadcastState();
        }
        break;
      case "signal": {
        // Only relay between people in the same call
        const target = rooms.get(roomId)?.participants.get(message.to);
        if (isSelf && target) {
          send(target.socket, { type: "signal", from: current.id, data: message.data });
        }
        break;
      }
      default:
        break;
    }
  }

  async function authenticate(socket, req) {
    // Only pages served from our own frontend may open call connections
    if (!isAllowedOrigin(req.headers.origin)) {
      socket.close(4003, "Origin not allowed");
      return false;
    }
    // Browsers can't set headers on WebSockets, so the session token is a query param
    const token = new URL(req.url, "http://localhost").searchParams.get("token");
    const member = await memberFromToken(token);
    if (!member) {
      socket.close(4001, "Not a member of #general");
      return false;
    }
    socket.memberId = member.id;
    socket.member = member;
    socket.memberCheckedAt = Date.now();
    sendState(socket);
    return true;
  }

  wss.on("connection", (socket, req) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    // Messages are queued behind authentication and handled one at a time,
    // so call setup (offer, answer, ICE candidates) is never reordered
    let queue = authenticate(socket, req);
    socket.on("message", (raw) => {
      queue = queue
        .then((ok) => (ok ? handleMessage(socket, raw).then(() => true) : false))
        .catch((error) => {
          logFailure(error);
          return Boolean(socket.memberId);
        });
    });

    socket.on("close", () => {
      if (!socket.memberId) return;
      const roomId = memberRoom.get(socket.memberId);
      if (rooms.get(roomId)?.participants.get(socket.memberId)?.socket === socket) {
        leave(socket.memberId);
      }
    });
  });

  // Drop connections that stopped responding (closed laptop, lost network)
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}

module.exports = { attachHuddleServer };
