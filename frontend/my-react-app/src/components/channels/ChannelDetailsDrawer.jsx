import { useState } from "react";
import { Drawer, Input, Button, Select, Popconfirm, Alert, Tag } from "antd";
import { LockOutlined, NumberOutlined, LogoutOutlined, DeleteOutlined } from "@ant-design/icons";
import { useDispatch, useSelector } from "react-redux";
import {
  setChannelTopic,
  addChannelMember,
  leaveChannel,
  deleteChannel
} from "../../features/channels/channelsSlice";
import MemberAvatar from "../general/MemberAvatar";

const sectionTitle = {
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "var(--text-tertiary)",
  margin: "18px 0 8px"
};

// Topic, members, add people, leave and delete for one channel
function ChannelDetailsDrawer({ open, onClose, channel, me, people, onLeft }) {
  const dispatch = useDispatch();
  const online = useSelector((state) => state.general.online);
  const [topic, setTopic] = useState(channel.topic || "");
  const [toAdd, setToAdd] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const members = channel.members.map((id) => byId[id]).filter(Boolean);
  const addable = people.filter((p) => !channel.members.includes(p.id));
  const canDelete = channel.createdBy === me.id || me.role === "owner";

  async function run(name, action) {
    setBusy(name);
    setError(null);
    try {
      return await dispatch(action).unwrap();
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {channel.private ? <LockOutlined /> : <NumberOutlined />}
          {channel.name}
          {channel.private && <Tag style={{ marginLeft: 4 }}>Private</Tag>}
        </span>
      }
      afterOpenChange={(isOpen) => isOpen && setTopic(channel.topic || "")}
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: "12px" }} />}

      {channel.joined && (
        <>
          <div style={{ ...sectionTitle, marginTop: 0 }}>Topic</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Add a topic"
              maxLength={250}
              aria-label="Channel topic"
            />
            <Button
              loading={busy === "topic"}
              disabled={topic.trim() === (channel.topic || "")}
              onClick={() => run("topic", setChannelTopic({ id: channel.id, topic }))}
            >
              Save
            </Button>
          </div>

          <div style={sectionTitle}>Add people</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Select
              style={{ flex: 1 }}
              placeholder={addable.length ? "Choose a teammate" : "Everyone is already here"}
              disabled={!addable.length}
              value={toAdd}
              onChange={setToAdd}
              showSearch
              optionFilterProp="label"
              options={addable.map((p) => ({ value: p.id, label: p.name }))}
              aria-label="Choose a teammate to add"
            />
            <Button
              type="primary"
              disabled={!toAdd}
              loading={busy === "add"}
              onClick={async () => {
                if (await run("add", addChannelMember({ id: channel.id, memberId: toAdd }))) {
                  setToAdd(null);
                }
              }}
            >
              Add
            </Button>
          </div>
        </>
      )}

      <div style={sectionTitle}>Members — {members.length}</div>
      {members.map((member) => (
        <div
          key={member.id}
          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" }}
        >
          <MemberAvatar member={member} size={30} online={online.includes(member.id)} />
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{member.name}</span>
          {member.id === me.id && <Tag color="blue">you</Tag>}
          {member.id === channel.createdBy && <Tag>creator</Tag>}
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "24px" }}>
        {channel.joined && (
          <Popconfirm
            title={`Leave #${channel.name}?`}
            description={channel.private ? "You'll need someone to add you back." : "You can rejoin any time."}
            okText="Leave"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              if (await run("leave", leaveChannel(channel.id))) onLeft(channel);
            }}
          >
            <Button icon={<LogoutOutlined />} loading={busy === "leave"} block>
              Leave channel
            </Button>
          </Popconfirm>
        )}
        {canDelete && (
          <Popconfirm
            title={`Delete #${channel.name}?`}
            description="All of its messages are deleted for everyone. This can't be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              if (await run("delete", deleteChannel(channel.id))) onLeft(channel);
            }}
          >
            <Button danger icon={<DeleteOutlined />} loading={busy === "delete"} block>
              Delete channel
            </Button>
          </Popconfirm>
        )}
      </div>
    </Drawer>
  );
}

export default ChannelDetailsDrawer;
