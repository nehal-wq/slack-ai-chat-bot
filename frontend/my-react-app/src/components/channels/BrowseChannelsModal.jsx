import { useState } from "react";
import { Modal, Input, Button, Empty, Tag } from "antd";
import { NumberOutlined, LockOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useSelector } from "react-redux";

// Lists every channel you can see; open one to preview or join it
function BrowseChannelsModal({ open, onClose, onOpenChannel, onCreate }) {
  const channels = useSelector((state) => state.channels.list);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = channels.filter(
    (c) => !q || c.name.includes(q) || (c.topic || "").toLowerCase().includes(q)
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Channels"
      footer={null}
      destroyOnHidden
      afterOpenChange={(isOpen) => !isOpen && setQuery("")}
    >
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Search channels"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
          autoFocus
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          Create
        </Button>
      </div>

      {shown.length === 0 ? (
        <Empty
          description={channels.length ? "No channels match your search." : "No channels yet. Create the first one!"}
        />
      ) : (
        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {shown.map((channel) => (
            <button
              type="button"
              key={channel.id}
              onClick={() => onOpenChannel(channel.id)}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 8px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                color: "var(--text)"
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                  {channel.private ? <LockOutlined /> : <NumberOutlined />}
                  {channel.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {channel.members.length} {channel.members.length === 1 ? "member" : "members"}
                  {channel.topic ? ` · ${channel.topic}` : ""}
                </span>
              </span>
              {channel.joined ? (
                <Tag color="green" style={{ margin: 0 }}>
                  Joined
                </Tag>
              ) : (
                <Tag style={{ margin: 0 }}>View</Tag>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default BrowseChannelsModal;
