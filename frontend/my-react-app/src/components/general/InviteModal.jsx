import { useState } from "react";
import { Modal, Form, Input, Button, Alert, Typography } from "antd";
import { MailOutlined, UserOutlined } from "@ant-design/icons";
import { useDispatch } from "react-redux";
import { inviteMember } from "../../features/general/generalSlice";

function InviteModal({ open, onClose, emailEnabled }) {
  const dispatch = useDispatch();
  const [form] = Form.useForm();
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function reset() {
    setResult(null);
    setError(null);
    form.resetFields();
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit({ email, name }) {
    setSubmitting(true);
    setError(null);
    try {
      const data = await dispatch(
        inviteMember({ email, name })
      ).unwrap();
      setResult(data);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title="Invite people to #general"
      footer={null}
      destroyOnHidden
    >
      {result ? (
        <div>
          {result.emailSent ? (
            <Alert
              type="success"
              showIcon
              title={`Invite ${result.resent ? "re-sent" : "sent"} to ${result.member.email}`}
              description="They'll get an email with a link to join #general."
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              title={`Invite created for ${result.member.email}`}
              description={`${result.emailError} Share the link below with them instead.`}
            />
          )}

          <div style={{ marginTop: "16px", fontSize: "13px", color: "#616061" }}>
            Invite link
          </div>
          <Typography.Paragraph
            copyable={{ text: result.inviteLink }}
            style={{
              background: "#F8F8F8",
              border: "1px solid #E2E2E2",
              borderRadius: "6px",
              padding: "8px 10px",
              fontSize: "12px",
              wordBreak: "break-all",
              marginTop: "4px"
            }}
          >
            {result.inviteLink}
          </Typography.Paragraph>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <Button onClick={reset}>Invite another</Button>
            <Button type="primary" onClick={handleClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          {!emailEnabled && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: "16px" }}
              title="Email sending isn't set up yet"
              description="You'll get an invite link to share. To send invite emails, add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to the backend .env file."
            />
          )}

          <Form.Item
            name="email"
            label="Email address"
            rules={[
              { required: true, message: "Enter an email address" },
              { type: "email", message: "Enter a valid email address" }
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="name@company.com" autoFocus />
          </Form.Item>

          <Form.Item name="name" label="Name (optional)">
            <Input prefix={<UserOutlined />} placeholder="Their display name" />
          </Form.Item>

          {error && (
            <Alert type="error" showIcon title={error} style={{ marginBottom: "16px" }} />
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              style={{ background: "#007A5A", borderColor: "#007A5A" }}
            >
              Send invite
            </Button>
          </div>
        </Form>
      )}
    </Modal>
  );
}

export default InviteModal;
