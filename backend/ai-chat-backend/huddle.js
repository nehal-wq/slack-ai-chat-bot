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

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function attachHuddleServer(
  server,
  { findJoinedMember, memberFromToken, addSystemMessage, addDirectSystemMessage }
) {
  const wss = new WebSocketServer({ server, path: "/ws/huddle" });

  // roomId -> { participants: Map<memberId, participant>, startedAt, startedBy, video, answered, declined }
  const rooms = new Map();
  // memberId -> roomId (a member can be in one call at a time)
  const memberRoom = new Map();

  // Who may join a room, and how big it can get
  function describeRoom(roomId, memberId) {
    if (roomId === GENERAL_ROOM) {
      return { kind: "general", max: MAX_GENERAL_PARTICIPANTS };
    }
    const match = /^dm:([^:]+):([^:]+)$/.exec(roomId || "");
    if (!match) return null;
    const [, a, b] = match;
    if (a >= b || (memberId !== a && memberId !== b)) return null;
    const otherId = memberId === a ? b : a;
    if (!findJoinedMember(otherId)) return null;
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
    for (const client of wss.clients) sendState(client);
  }

  function endRoom(roomId, room) {
    rooms.delete(roomId);
    const duration = formatDuration(Date.now() - room.startedAt);

    if (roomId === GENERAL_ROOM) {
      addSystemMessage(`Huddle ended · lasted ${duration}`);
      return;
    }

    const [, a, b] = roomId.split(":");
    const kind = room.video ? "video call" : "call";
    let text;
    if (room.answered) text = `📞 ${kind[0].toUpperCase()}${kind.slice(1)} ended · lasted ${duration}`;
    else if (room.declined) text = `📞 ${room.startedBy}'s ${kind} was declined`;
    else text = `📞 Missed ${kind} from ${room.startedBy}`;
    addDirectSystemMessage(a, b, text);
  }

  function leave(memberId) {
    const roomId = memberRoom.get(memberId);
    const room = roomId && rooms.get(roomId);
    memberRoom.delete(memberId);
    if (!room || !room.participants.delete(memberId)) return;
    if (room.participants.size === 0) endRoom(roomId, room);
    broadcastState();
  }

  function handleJoin(socket, member, message) {
    const roomId = message.room || GENERAL_ROOM;
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

    const info = describeRoom(roomId, member.id);
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
        );
        // Ring everyone else who is online
        for (const client of wss.clients) {
          if (client.memberId !== member.id) send(client, ring);
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

  function handleDecline(member, message) {
    const roomId = message.room;
    const room = rooms.get(roomId);
    const info = room && describeRoom(roomId, member.id);
    if (!info || info.kind !== "dm" || room.participants.has(member.id)) return;
    room.declined = true;
    for (const participant of room.participants.values()) {
      send(participant.socket, { type: "declined", room: roomId, by: member.name });
    }
  }

  wss.on("connection", (socket, req) => {
    // Browsers can't set headers on WebSockets, so the session token is a query param
    const token = new URL(req.url, "http://localhost").searchParams.get("token");
    const member = memberFromToken(token);
    if (!member) {
      socket.close(4001, "Not a member of #general");
      return;
    }

    socket.memberId = member.id;
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    sendState(socket);

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      // Re-check membership: people can be removed from #general mid-session
      const current = findJoinedMember(socket.memberId);
      if (!current) {
        socket.close(4001, "Not a member of #general");
        return;
      }

      const roomId = memberRoom.get(current.id);
      const self = roomId && rooms.get(roomId)?.participants.get(current.id);
      const isSelf = self && self.socket === socket;

      switch (message.type) {
        case "join":
          handleJoin(socket, current, message);
          break;
        case "leave":
          if (isSelf) leave(current.id);
          break;
        case "decline":
          handleDecline(current, message);
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
    });

    socket.on("close", () => {
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
