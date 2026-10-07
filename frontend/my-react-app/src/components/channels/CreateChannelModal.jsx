import { useState } from "react";
import { Modal, Form, Input, Switch, Button, Alert } from "antd";
import { NumberOutlined, LockOutlined } from "@ant-design/icons";
import { useDispatch } from "react-redux";
import { createChannel } from "../../features/channels/channelsSlice";

// Same rules as the backend: lowercase letters, numbers, - and _
function previewName(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40);
}

function CreateChannelModal({ open, onClose, onCreated }) {
  const dispatch = useDispatch();
  const [form] = Form.useForm();
  const [isPrivate, setIsPrivate] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function close() {
    form.resetFields();
    setIsPrivate(false);
    setName("");
    setError(null);
    onClose();
  }

  async function submit({ name: rawName, topic }) {
    setSaving(true);
    setError(null);
    try {
      const { channel } = await dispatch(
        createChannel({ name: rawName, topic, private: isPrivate })
      ).unwrap();
      close();
      onCreated(channel);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const cleaned = previewName(name);

  return (
    <Modal open={open} onCancel={close} title="Create a channel" footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item
          name="name"
          label="Name"
          rules={[
            { required: true, message: "Give the channel a name" },
            {
              validator: (_, value) =>
                previewName(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error("Use letters or numbers")),
              validateTrigger: "onSubmit"
            }
          ]}
          extra={cleaned ? `Will be created as #${cleaned}` : "e.g. design, marketing, release-2026"}
        >
          <Input
            prefix={isPrivate ? <LockOutlined /> : <NumberOutlined />}
            placeholder="e.g. design"
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Form.Item>

        <Form.Item name="topic" label="Topic (optional)">
          <Input placeholder="What's this channel about?" maxLength={250} />
        </Form.Item>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "16px"
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: "var(--text)" }}>Make private</div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              {isPrivate
                ? "Only people you add can see and join this channel."
                : "Everyone in the workspace can find and join this channel."}
            </div>
          </div>
          <Switch checked={isPrivate} onChange={setIsPrivate} aria-label="Make private" />
        </div>

        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: "16px" }} />}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            Create
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

export default CreateChannelModal;
