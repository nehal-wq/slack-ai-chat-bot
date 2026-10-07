import { useState, useEffect, useRef, useCallback } from "react";
import { WS_BASE } from "../../config";
import { getSessionToken, apiRequest } from "../auth/session";
import { publish, setRealtimeSender } from "../realtime/realtimeBus";

// Peer-to-peer audio/video calls: #general huddles and 1:1 direct calls.
// The backend relays signaling messages over a WebSocket; media goes
// directly between browsers via WebRTC.

// Used if the backend can't be asked (it adds TURN servers when configured)
const DEFAULT_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
];
const VIDEO_CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 360 } };
const RECONNECT_DELAY_MS = 2000;
const NOT_A_MEMBER_CODE = 4001;
export const GENERAL_ROOM = "general";

// Room id for a direct call between two members (same for both sides)
export function directRoomId(a, b) {
  return `dm:${[a, b].sort().join(":")}`;
}

// Get mic (and camera) with graceful fallbacks so people can still join
async function getLocalMedia(wantVideo) {
  const notes = [];

  if (!navigator.mediaDevices?.getUserMedia) {
    notes.push(
      "This browser blocks the camera and microphone on this address (it needs https or localhost), so you joined listen-only."
    );
    return { stream: new MediaStream(), notes };
  }

  if (wantVideo) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: VIDEO_CONSTRAINTS
      });
      return { stream, notes };
    } catch {
      notes.push("Camera unavailable, so you joined with audio only.");
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { stream, notes };
  } catch (err) {
    notes.push(
      err.name === "NotAllowedError"
        ? "Microphone permission was denied, so you joined listen-only."
        : "No microphone found, so you joined listen-only."
    );
    return { stream: new MediaStream(), notes };
  }
}

function useHuddle(memberId) {
  const [rooms, setRooms] = useState({});
  const [activeRoom, setActiveRoom] = useState(null);
  const [activeLabel, setActiveLabel] = useState(null);
  const [connected, setConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [joining, setJoining] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [peerStates, setPeerStates] = useState({});
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [notice, setNotice] = useState(null);
  const [ring, setRing] = useState(null);

  const socketRef = useRef(null);
  const peersRef = useRef(new Map()); // memberId -> { pc, pendingCandidates, stream }
  const localStreamRef = useRef(null);
  const inCallRef = useRef(false);
  const activeRoomRef = useRef(null);
  const joinAckedRef = useRef(false);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const handleMessageRef = useRef(null);

  const send = useCallback((message) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const localTrack = useCallback(
    (kind) => localStreamRef.current?.getTracks().find((t) => t.kind === kind) || null,
    []
  );

  const closePeer = useCallback((id) => {
    const entry = peersRef.current.get(id);
    if (!entry) return;
    entry.pc.close();
    peersRef.current.delete(id);
    const without = (map) => {
      const next = { ...map };
      delete next[id];
      return next;
    };
    setRemoteStreams(without);
    setPeerStates(without);
  }, []);

  const createPeer = useCallback(
    (id) => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      const entry = { pc, pendingCandidates: [], stream: new MediaStream() };
      peersRef.current.set(id, entry);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({ type: "signal", to: id, data: { candidate: event.candidate.toJSON() } });
        }
      };
      pc.ontrack = (event) => {
        entry.stream.addTrack(event.track);
        // New object so React re-attaches the media element
        setRemoteStreams((streams) => ({
          ...streams,
          [id]: new MediaStream(entry.stream.getTracks())
        }));
      };
      pc.onconnectionstatechange = () => {
        setPeerStates((states) => ({ ...states, [id]: pc.connectionState }));
      };

      return entry;
    },
    [send]
  );

  // Swap the outgoing track of one kind on every peer connection (no renegotiation)
  const replaceOutgoingTrack = useCallback((kind, track) => {
    for (const { pc } of peersRef.current.values()) {
      for (const transceiver of pc.getTransceivers()) {
        if (transceiver.receiver.track?.kind === kind) {
          transceiver.sender.replaceTrack(track).catch(() => {});
        }
      }
    }
  }, []);

  const flushCandidates = useCallback(async (entry) => {
    for (const candidate of entry.pendingCandidates.splice(0)) {
      await entry.pc.addIceCandidate(candidate).catch(() => {});
    }
  }, []);

  // We joined: call everyone already in the huddle
  const callPeer = useCallback(
    async (id) => {
      const { pc } = createPeer(id);
      // Always negotiate both kinds so camera/mic can be switched on later
      for (const kind of ["audio", "video"]) {
        pc.addTransceiver(localTrack(kind) || kind, { direction: "sendrecv" });
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: "signal", to: id, data: { sdp: pc.localDescription.toJSON() } });
    },
    [createPeer, localTrack, send]
  );

  const handleSignal = useCallback(
    async (from, data) => {
      if (!inCallRef.current) return;
      let entry = peersRef.current.get(from);

      if (data.sdp?.type === "offer") {
        if (entry) closePeer(from);
        entry = createPeer(from);
        const { pc } = entry;
        await pc.setRemoteDescription(data.sdp);
        for (const transceiver of pc.getTransceivers()) {
          transceiver.direction = "sendrecv";
          await transceiver.sender.replaceTrack(localTrack(transceiver.receiver.track.kind));
        }
        await pc.setLocalDescription(await pc.createAnswer());
        send({ type: "signal", to: from, data: { sdp: pc.localDescription.toJSON() } });
        await flushCandidates(entry);
      } else if (data.sdp?.type === "answer" && entry) {
        await entry.pc.setRemoteDescription(data.sdp);
        await flushCandidates(entry);
      } else if (data.candidate && entry) {
        if (entry.pc.remoteDescription) {
          await entry.pc.addIceCandidate(data.candidate).catch(() => {});
        } else {
          entry.pendingCandidates.push(data.candidate);
        }
      }
    },
    [closePeer, createPeer, flushCandidates, localTrack, send]
  );

  const cleanupLocal = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) closePeer(id);
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    inCallRef.current = false;
    joinAckedRef.current = false;
    activeRoomRef.current = null;
    setActiveRoom(null);
    setActiveLabel(null);
    setLocalStream(null);
    setInCall(false);
    setMicOn(false);
    setCamOn(false);
  }, [closePeer]);

  // Latest message handler, read by the long-lived socket
  useEffect(() => {
    handleMessageRef.current = (message) => {
      switch (message.type) {
        case "rooms": {
          setRooms(message.rooms);
          if (!inCallRef.current || !joinAckedRef.current) break;
          const call = message.rooms[activeRoomRef.current];
          const ids = new Set(call?.participants.map((p) => p.memberId) || []);
          if (!ids.has(memberId)) {
            cleanupLocal();
            setNotice("You were disconnected from the call.");
            break;
          }
          for (const id of [...peersRef.current.keys()]) {
            if (!ids.has(id)) closePeer(id);
          }
          break;
        }
        case "joined":
          joinAckedRef.current = true;
          message.peers.forEach((id) => callPeer(id).catch(() => closePeer(id)));
          break;
        case "signal":
          handleSignal(message.from, message.data).catch(() => closePeer(message.from));
          break;
        case "ring":
          if (!inCallRef.current) {
            setRing({
              room: message.room,
              from: message.from,
              video: message.video,
              direct: message.direct
            });
          }
          break;
        case "declined":
          if (message.room === activeRoomRef.current) {
            setNotice(`${message.by} declined the call.`);
            // Nobody else is on the line, so hang up
            if (peersRef.current.size === 0) {
              send({ type: "leave" });
              cleanupLocal();
            }
          }
          break;
        case "error":
          setNotice(message.error);
          if (!joinAckedRef.current) cleanupLocal();
          break;
        default:
          // Chat events (new messages, presence, typing) go to whoever subscribed
          publish(message);
          break;
      }
    };
  }, [memberId, callPeer, closePeer, cleanupLocal, handleSignal, send]);

  // Let chat features send small signals (e.g. typing) on this socket
  useEffect(() => {
    setRealtimeSender(send);
    return () => setRealtimeSender(null);
  }, [send]);

  // One signaling socket per signed-in member, reconnecting if it drops
  useEffect(() => {
    if (!memberId) return undefined;
    let socket;
    let retryTimer;
    let stopped = false;

    function connect() {
      // The server identifies us from the session, not from memberId
      const token = getSessionToken() || "";
      socket = new WebSocket(`${WS_BASE}/ws/huddle?token=${encodeURIComponent(token)}`);
      socketRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        // Screens re-fetch on (re)connect to catch anything missed while offline
        publish({ type: "realtime:connected" });
      };
      socket.onmessage = (event) => {
        try {
          handleMessageRef.current?.(JSON.parse(event.data));
        } catch {
          // Ignore malformed messages
        }
      };
      socket.onclose = (event) => {
        setConnected(false);
        setRooms({});
        if (inCallRef.current) {
          cleanupLocal();
          setNotice("Lost connection to the call.");
        }
        if (!stopped && event.code !== NOT_A_MEMBER_CODE) {
          retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket.close();
      socketRef.current = null;
      cleanupLocal();
    };
  }, [memberId, cleanupLocal]);

  // room: GENERAL_ROOM or directRoomId(...); label: shown in the call panel
  const join = useCallback(
    async (withVideo, room = GENERAL_ROOM, label = null) => {
      if (inCallRef.current || joining) return;
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        setNotice("Not connected to the call server. Is the backend running?");
        return;
      }

      setJoining(true);
      setNotice(null);
      const [{ stream, notes }, ice] = await Promise.all([
        getLocalMedia(withVideo),
        apiRequest("/calls/ice-servers").catch(() => null)
      ]);
      iceServersRef.current = ice?.iceServers || DEFAULT_ICE_SERVERS;
      const hasAudio = stream.getAudioTracks().length > 0;
      const hasVideo = stream.getVideoTracks().length > 0;

      localStreamRef.current = stream;
      inCallRef.current = true;
      activeRoomRef.current = room;
      setActiveRoom(room);
      setActiveLabel(label);
      setLocalStream(stream);
      setMicOn(hasAudio);
      setCamOn(hasVideo);
      setInCall(true);
      setRing(null);
      setJoining(false);
      if (notes.length) setNotice(notes.join(" "));

      send({ type: "join", room, audio: hasAudio, video: hasVideo });
    },
    [joining, send]
  );

  const leave = useCallback(() => {
    send({ type: "leave" });
    cleanupLocal();
    setNotice(null);
  }, [cleanupLocal, send]);

  // Turn a device on (asking for it if needed) or off, then tell the others
  const toggleDevice = useCallback(
    async (kind) => {
      const stream = localStreamRef.current;
      if (!stream) return;
      const current = stream.getTracks().find((t) => t.kind === kind);
      let audio = Boolean(stream.getAudioTracks()[0]?.enabled);
      let video = stream.getVideoTracks().length > 0;

      if (kind === "audio" && current) {
        current.enabled = !current.enabled;
        audio = current.enabled;
      } else if (kind === "video" && current) {
        current.stop();
        stream.removeTrack(current);
        replaceOutgoingTrack("video", null);
        video = false;
      } else {
        try {
          const extra = await navigator.mediaDevices.getUserMedia(
            kind === "video" ? { video: VIDEO_CONSTRAINTS } : { audio: true }
          );
          const track = extra.getTracks()[0];
          stream.addTrack(track);
          replaceOutgoingTrack(kind, track);
          if (kind === "video") video = true;
          else audio = true;
        } catch {
          setNotice(`Couldn't turn on your ${kind === "video" ? "camera" : "microphone"}.`);
          return;
        }
      }

      setMicOn(audio);
      setCamOn(video);
      setLocalStream(new MediaStream(stream.getTracks()));
      send({ type: "media", audio, video });
    },
    [replaceOutgoingTrack, send]
  );

  const toggleMic = useCallback(() => toggleDevice("audio"), [toggleDevice]);
  const toggleCamera = useCallback(() => toggleDevice("video"), [toggleDevice]);
  const dismissRing = useCallback(() => setRing(null), []);
  // Direct calls: tell the caller instead of silently ignoring them
  const declineRing = useCallback(() => {
    if (ring?.direct) send({ type: "decline", room: ring.room });
    setRing(null);
  }, [ring, send]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    memberId,
    // #general huddle (null when none is running)
    huddle: rooms[GENERAL_ROOM] || null,
    rooms,
    activeRoom,
    activeLabel,
    // The call you're in, if any
    call: activeRoom ? rooms[activeRoom] || null : null,
    connected,
    inCall,
    joining,
    localStream,
    remoteStreams,
    peerStates,
    micOn,
    camOn,
    notice,
    ring: ring && rooms[ring.room] ? ring : null,
    join,
    leave,
    toggleMic,
    toggleCamera,
    dismissRing,
    declineRing,
    dismissNotice
  };
}

export default useHuddle;
