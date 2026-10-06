import { useState, useEffect, useRef } from "react";
import { Button, Tooltip, Alert } from "antd";
import {
  AudioOutlined,
  AudioMutedOutlined,
  VideoCameraOutlined,
  VideoCameraAddOutlined,
  ExpandOutlined,
  CompressOutlined,
  PhoneOutlined,
  CustomerServiceOutlined
} from "@ant-design/icons";
import MemberAvatar from "../general/MemberAvatar";
import { GENERAL_ROOM } from "../../features/huddle/useHuddle";

function formatElapsed(startedAt, now) {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// A <video> element bound to a MediaStream. Hidden video elements still play
// audio, so remote tiles keep their sound when the camera is off.
function StreamVideo({ stream, muted, mirrored, visible }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: mirrored ? "scaleX(-1)" : undefined,
        display: visible ? "block" : "none"
      }}
    />
  );
}

function ParticipantTile({ participant, stream, isLocal, connectionState, videoOn, audioOn }) {
  const connecting = !isLocal && connectionState !== "connected";

  return (
    <div
      style={{
        position: "relative",
        aspectRatio: "16 / 9",
        background: "#1D1C1D",
        borderRadius: "8px",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <StreamVideo stream={stream} muted={isLocal} mirrored={isLocal} visible={videoOn} />

      {!videoOn && (
        <MemberAvatar
          member={{ id: participant.memberId, name: participant.name, status: "joined" }}
          size={48}
        />
      )}

      <div
        style={{
          position: "absolute",
          left: "6px",
          bottom: "6px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          borderRadius: "4px",
          background: "rgba(0,0,0,0.6)",
          color: "#FFFFFF",
          fontSize: "12px",
          maxWidth: "calc(100% - 12px)"
        }}
      >
        {!audioOn && <AudioMutedOutlined style={{ color: "#FF6B6B" }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isLocal ? `${participant.name} (you)` : participant.name}
        </span>
      </div>

      {connecting && (
        <div
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            padding: "2px 8px",
            borderRadius: "4px",
            background: connectionState === "failed" ? "#B42318" : "rgba(0,0,0,0.6)",
            color: "#FFFFFF",
            fontSize: "11px"
          }}
        >
          {connectionState === "failed" ? "Couldn't connect" : "Connecting…"}
        </div>
      )}
    </div>
  );
}

function RingCard({ ring, onJoin, onDismiss }) {
  return (
    <div
      style={{
        position: "fixed",
        right: "16px",
        bottom: "16px",
        width: "min(340px, calc(100vw - 32px))",
        background: "#FFFFFF",
        border: "1px solid #E2E2E2",
        borderRadius: "12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        padding: "16px",
        zIndex: 1000
      }}
    >
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <CustomerServiceOutlined style={{ fontSize: "22px", color: "#007A5A" }} />
        <div>
          <div style={{ fontWeight: 700, color: "#1D1C1D" }}>
            {ring.direct
              ? `${ring.from} is calling you`
              : `${ring.from} started ${ring.video ? "a video" : "an audio"} huddle`}
          </div>
          <div style={{ fontSize: "12px", color: "#616061" }}>
            {ring.direct ? `Direct ${ring.video ? "video" : "audio"} call` : "in #general"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
        <Button
          type="primary"
          icon={<AudioOutlined />}
          onClick={() => onJoin(false)}
          style={{ background: "#007A5A", borderColor: "#007A5A", flex: 1 }}
        >
          {ring.direct ? "Accept" : "Join"}
        </Button>
        <Button icon={<VideoCameraOutlined />} onClick={() => onJoin(true)} style={{ flex: 1 }}>
          With video
        </Button>
        <Button type="text" danger={ring.direct} onClick={onDismiss}>
          {ring.direct ? "Decline" : "Dismiss"}
        </Button>
      </div>
    </div>
  );
}

const controlStyle = (active) => ({
  background: active ? "rgba(255,255,255,0.12)" : "#E01E5A",
  borderColor: "transparent",
  color: "#FFFFFF"
});

function HuddlePanel({ huddle }) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = huddle.call?.startedAt;
  const isDirect = Boolean(huddle.activeRoom) && huddle.activeRoom !== GENERAL_ROOM;

  useEffect(() => {
    if (!huddle.inCall) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [huddle.inCall]);

  if (!huddle.inCall) {
    return (
      <>
        {huddle.ring && (
          <RingCard
            ring={huddle.ring}
            onJoin={(withVideo) =>
              huddle.join(
                withVideo,
                huddle.ring.room,
                huddle.ring.direct ? huddle.ring.from : null
              )
            }
            onDismiss={huddle.ring.direct ? huddle.declineRing : huddle.dismissRing}
          />
        )}
        {huddle.notice && (
          <Alert
            type="warning"
            showIcon
            closable
            onClose={huddle.dismissNotice}
            title={huddle.notice}
            style={{
              position: "fixed",
              right: "16px",
              bottom: huddle.ring ? "170px" : "16px",
              width: "min(340px, calc(100vw - 32px))",
              zIndex: 1000
            }}
          />
        )}
      </>
    );
  }

  const participants = huddle.call?.participants || [];
  const self = participants.find((p) => p.memberId === huddle.memberId) || {
    memberId: huddle.memberId,
    name: "You"
  };
  const others = participants.filter((p) => p.memberId !== huddle.memberId);

  const panelStyle = expanded
    ? {
        position: "fixed",
        inset: "16px",
        width: "auto"
      }
    : {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        width: "min(360px, calc(100vw - 32px))"
      };

  return (
    <div
      style={{
        ...panelStyle,
        background: "#2C2D30",
        borderRadius: "12px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        padding: "12px",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        color: "#FFFFFF"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700 }}>
          <CustomerServiceOutlined style={{ color: "#2BAC76" }} />
          {isDirect ? `Call with ${huddle.activeLabel || "teammate"}` : "Huddle · #general"}
          <span style={{ fontWeight: 400, color: "#ABABAD", fontSize: "12px" }}>
            {startedAt ? formatElapsed(startedAt, now) : ""} · {participants.length}{" "}
            {participants.length === 1 ? "person" : "people"}
          </span>
        </div>
        <Tooltip title={expanded ? "Minimize" : "Expand"}>
          <Button
            type="text"
            size="small"
            icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={() => setExpanded(!expanded)}
            style={{ color: "#FFFFFF" }}
          />
        </Tooltip>
      </div>

      {huddle.notice && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={huddle.dismissNotice}
          title={huddle.notice}
          style={{ fontSize: "12px" }}
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: expanded
            ? "repeat(auto-fit, minmax(280px, 1fr))"
            : "repeat(2, 1fr)",
          gap: "8px",
          alignContent: "center",
          flex: expanded ? 1 : undefined,
          overflowY: "auto"
        }}
      >
        <ParticipantTile
          participant={self}
          stream={huddle.localStream}
          isLocal
          videoOn={huddle.camOn}
          audioOn={huddle.micOn}
        />
        {others.map((p) => (
          <ParticipantTile
            key={p.memberId}
            participant={p}
            stream={huddle.remoteStreams[p.memberId]}
            connectionState={huddle.peerStates[p.memberId]}
            videoOn={p.video}
            audioOn={p.audio}
          />
        ))}
      </div>

      {others.length === 0 && (
        <div style={{ textAlign: "center", fontSize: "12px", color: "#ABABAD" }}>
          {isDirect
            ? `Calling ${huddle.activeLabel || "your teammate"}…`
            : "Waiting for others to join… everyone online in #general was notified."}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
        <Tooltip title={huddle.micOn ? "Mute" : "Unmute"}>
          <Button
            shape="circle"
            size="large"
            icon={huddle.micOn ? <AudioOutlined /> : <AudioMutedOutlined />}
            onClick={huddle.toggleMic}
            style={controlStyle(huddle.micOn)}
          />
        </Tooltip>
        <Tooltip title={huddle.camOn ? "Turn off camera" : "Turn on camera"}>
          <Button
            shape="circle"
            size="large"
            icon={huddle.camOn ? <VideoCameraOutlined /> : <VideoCameraAddOutlined />}
            onClick={huddle.toggleCamera}
            style={controlStyle(huddle.camOn)}
          />
        </Tooltip>
        <Button
          size="large"
          icon={<PhoneOutlined style={{ transform: "rotate(135deg)" }} />}
          onClick={huddle.leave}
          style={{ background: "#E01E5A", borderColor: "#E01E5A", color: "#FFFFFF" }}
        >
          Leave
        </Button>
      </div>
    </div>
  );
}

export default HuddlePanel;
