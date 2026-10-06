import { useState } from "react";
import { Drawer, Button, Popconfirm, Tag, Alert, Tooltip } from "antd";
import { UserAddOutlined, LogoutOutlined, CrownFilled } from "@ant-design/icons";
import { useDispatch } from "react-redux";
import {
  removeMember,
  makeOwner,
  signOut,
  fetchGeneral
} from "../../features/general/generalSlice";
import MemberAvatar from "./MemberAvatar";
import InvitePermissionSetting from "./InvitePermissionSetting";

const sectionTitleStyle = {
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "#868686",
  margin: "4px 0 8px"
};

// Mirrors the backend rules: the owner removes anyone but themselves,
// members can leave and revoke invites they sent
function canRemove(currentMember, member) {
  if (!currentMember || member.role === "owner") return false;
  if (currentMember.role === "owner" || member.id === currentMember.id) return true;
  return member.status === "invited" && member.invitedBy === currentMember.id;
}

function MemberRow({ member, currentMember, onRemove, onMakeOwner }) {
  const isYou = member.id === currentMember?.id;
  const isPending = member.status === "invited";
  const isOwner = member.role === "owner";
  const canTransfer =
    currentMember?.role === "owner" && !isYou && !isPending;

  let actionLabel = "Remove";
  let confirmText = `Remove ${member.name} from #general?`;
  if (isPending) {
    actionLabel = "Revoke";
    confirmText = `Revoke the invite for ${member.email}?`;
  } else if (isYou) {
    actionLabel = "Leave";
    confirmText = "Leave #general? You can join again later.";
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "8px 0"
      }}
    >
      <MemberAvatar member={member} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontWeight: 600, color: "#1D1C1D" }}>{member.name}</span>
          {isOwner && (
            <Tag color="gold" icon={<CrownFilled />}>
              Owner
            </Tag>
          )}
          {isYou && <Tag color="blue">you</Tag>}
          {isPending && <Tag>pending</Tag>}
        </div>
        <div
          style={{
            fontSize: "12px",
            color: "#868686",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {member.email}
        </div>
      </div>
      {canTransfer && (
        <Popconfirm
          title={`Make ${member.name} the workspace owner?`}
          description="You'll become a regular member."
          okText="Make owner"
          onConfirm={() => onMakeOwner(member)}
        >
          <Button size="small" type="text">
            Make owner
          </Button>
        </Popconfirm>
      )}
      {canRemove(currentMember, member) && (
        <Popconfirm
          title={confirmText}
          okText={actionLabel}
          okButtonProps={{ danger: true }}
          onConfirm={() => onRemove(member)}
        >
          <Button size="small" type="text" danger>
            {actionLabel}
          </Button>
        </Popconfirm>
      )}
    </div>
  );
}

function MembersDrawer({ open, onClose, members, currentMember, canInvite, onInvite }) {
  const dispatch = useDispatch();
  const [error, setError] = useState(null);

  const joined = members.filter((m) => m.status === "joined");
  const pending = members.filter((m) => m.status === "invited");

  async function handleRemove(member) {
    setError(null);
    try {
      await dispatch(
        removeMember({ memberId: member.id })
      ).unwrap();
      dispatch(fetchGeneral());
    } catch (err) {
      setError(err);
    }
  }

  async function handleMakeOwner(member) {
    setError(null);
    try {
      await dispatch(
        makeOwner({ memberId: member.id })
      ).unwrap();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Members of #general (${joined.length})`}
      extra={
        <Tooltip title={canInvite ? "" : "Only the workspace owner can invite people"}>
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={onInvite}
            disabled={!canInvite}
            style={canInvite ? { background: "#007A5A", borderColor: "#007A5A" } : undefined}
          >
            Invite
          </Button>
        </Tooltip>
      }
      footer={
        currentMember && (
          <Button
            block
            icon={<LogoutOutlined />}
            onClick={() => {
              dispatch(signOut());
              onClose();
            }}
          >
            Sign out ({currentMember.name})
          </Button>
        )
      }
    >
      {error && (
        <Alert type="error" showIcon title={error} style={{ marginBottom: "12px" }} />
      )}

      {currentMember && (
        <div
          style={{
            padding: "12px",
            marginBottom: "16px",
            borderRadius: "8px",
            background: "#F8F8F8",
            border: "1px solid #E2E2E2"
          }}
        >
          <InvitePermissionSetting currentMember={currentMember} />
        </div>
      )}

      <div style={sectionTitleStyle}>In this channel — {joined.length}</div>
      {joined.length === 0 && (
        <div style={{ color: "#868686", fontSize: "13px" }}>No one has joined yet.</div>
      )}
      {joined.map((member) => (
        <MemberRow
          key={member.id}
          member={member}
          currentMember={currentMember}
          onRemove={handleRemove}
          onMakeOwner={handleMakeOwner}
        />
      ))}

      {pending.length > 0 && (
        <>
          <div style={{ ...sectionTitleStyle, marginTop: "20px" }}>
            Pending invites — {pending.length}
          </div>
          {pending.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              currentMember={currentMember}
              onRemove={handleRemove}
              onMakeOwner={handleMakeOwner}
            />
          ))}
        </>
      )}
    </Drawer>
  );
}

export default MembersDrawer;
