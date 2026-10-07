import { useState, useEffect } from "react";
import { Form, Input, Button, Alert, Spin } from "antd";
import { MailOutlined, UserOutlined, CheckCircleFilled } from "@ant-design/icons";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchInvite,
  requestLogin,
  pollLogin,
  acceptInvite,
  fetchGeneral
} from "../../features/general/generalSlice";

const panelStyle = {
  marginTop: "16px",
  padding: "20px",
  background: "var(--surface)",
  border: "1px solid var(--border-strong)",
  borderRadius: "10px",
  boxShadow: "var(--shadow-md)"
};

const LOGIN_POLL_MS = 2000;
const LINK_LIFETIME_MS = 15 * 60 * 1000;

const greenButtonStyle = {
  background: "#007A5A",
  borderColor: "#007A5A",
  fontWeight: 600
};

// Shown in place of the composer when the viewer isn't signed in, or when
// they opened an invite link. Signing in is passwordless: we email a link.
function JoinPanel({ inviteToken, currentMember, sessionExpired, onInviteHandled }) {
  const dispatch = useDispatch();
  const loginError = useSelector((state) => state.general.loginError);
  const [linkSent, setLinkSent] = useState(null);

  // While "Check your email" is showing, sign this page in as soon as the link
  // is clicked, wherever it was opened. Stops when the link would have expired.
  const pendingRequestId = linkSent?.requestId;
  useEffect(() => {
    if (!pendingRequestId) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > LINK_LIFETIME_MS) {
        clearInterval(timer);
        return;
      }
      const result = await dispatch(pollLogin(pendingRequestId));
      if (result.payload?.sessionToken) {
        clearInterval(timer);
        dispatch(fetchGeneral());
      }
    }, LOGIN_POLL_MS);
    return () => clearInterval(timer);
  }, [dispatch, pendingRequestId]);
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [loadingInvite, setLoadingInvite] = useState(Boolean(inviteToken));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!inviteToken) return;
    dispatch(fetchInvite(inviteToken))
      .unwrap()
      .then(setInvite)
      .catch(setInviteError)
      .finally(() => setLoadingInvite(false));
  }, [dispatch, inviteToken]);

  async function submit(action) {
    setSubmitting(true);
    setError(null);
    try {
      await dispatch(action).unwrap();
      dispatch(fetchGeneral());
      if (inviteToken) onInviteHandled();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingInvite) {
    return (
      <div style={{ ...panelStyle, textAlign: "center" }}>
        <Spin size="small" /> <span style={{ marginLeft: "8px" }}>Checking your invite…</span>
      </div>
    );
  }

  if (invite) {
    return (
      <div style={panelStyle}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)" }}>
          {invite.invitedByName} invited you to #general 🎉
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "4px 0 14px" }}>
          Joining as <strong>{invite.email}</strong>
        </div>
        {currentMember && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: "14px" }}
            title={`This browser is signed in as ${currentMember.name} (${currentMember.email})`}
            description={`Accepting signs this browser in as ${invite.email} instead. To keep using ${currentMember.name} here, choose "Stay as ${currentMember.name}" and open the invite link in a private window or another browser.`}
          />
        )}
        <Form
          layout="inline"
          initialValues={{ name: invite.name }}
          onFinish={({ name }) => submit(acceptInvite({ token: inviteToken, name }))}
          style={{ rowGap: "8px" }}
        >
          <Form.Item
            name="name"
            rules={[{ required: true, message: "Enter your name" }]}
            style={{ flex: 1, minWidth: "200px" }}
          >
            <Input prefix={<UserOutlined />} placeholder="Your display name" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} style={greenButtonStyle}>
            {currentMember ? "Accept and switch account" : "Accept invite"}
          </Button>
          {currentMember && (
            <Button onClick={onInviteHandled} style={{ marginLeft: "8px" }}>
              Stay as {currentMember.name}
            </Button>
          )}
        </Form>
        {error && <Alert type="error" showIcon title={error} style={{ marginTop: "12px" }} />}
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {inviteError && (
        <Alert
          type="warning"
          showIcon
          title={inviteError}
          style={{ marginBottom: "14px" }}
          closable
          onClose={onInviteHandled}
        />
      )}
      {loginError && !linkSent && (
        <Alert type="error" showIcon title={loginError} style={{ marginBottom: "14px" }} />
      )}

      {linkSent ? (
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
          <CheckCircleFilled style={{ color: "var(--brand-text)", fontSize: "22px", marginTop: "2px" }} />
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)" }}>
              Check your email
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "4px 0 10px" }}>
              {linkSent.emailed
                ? `We sent a sign-in link to ${linkSent.email}. Click it on any device (this computer or your phone) and this page will sign you in automatically. The link expires in 15 minutes.`
                : "Email isn't configured on the server, so the sign-in link was printed in the backend server log."}
            </div>
            {linkSent.emailed && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  marginBottom: "10px"
                }}
              >
                <Spin size="small" /> Waiting for you to click the link…
              </div>
            )}
            <Button size="small" onClick={() => setLinkSent(null)}>
              Use a different email
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)" }}>
            {sessionExpired ? "Your session expired. Sign in again" : "Sign in to #general"}
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "4px 0 14px" }}>
            Enter your email and we'll send you a sign-in link. No password needed. New here?
            Ask a teammate to invite you.
          </div>
          <Form
            layout="inline"
            onFinish={async ({ name, email }) => {
              setSubmitting(true);
              setError(null);
              try {
                setLinkSent(await dispatch(requestLogin({ name, email })).unwrap());
              } catch (err) {
                setError(err);
              } finally {
                setSubmitting(false);
              }
            }}
            style={{ rowGap: "8px" }}
            requiredMark={false}
          >
            <Form.Item
              name="email"
              rules={[
                { required: true, message: "Enter your email" },
                { type: "email", message: "Enter a valid email" }
              ]}
              style={{ flex: 1, minWidth: "220px" }}
            >
              <Input prefix={<MailOutlined />} placeholder="you@company.com" />
            </Form.Item>
            <Form.Item name="name" style={{ flex: 1, minWidth: "160px" }}>
              <Input prefix={<UserOutlined />} placeholder="Your name (first sign-in only)" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} style={greenButtonStyle}>
              Email me a link
            </Button>
          </Form>
        </>
      )}
      {error && <Alert type="error" showIcon title={error} style={{ marginTop: "12px" }} />}
    </div>
  );
}

export default JoinPanel;
