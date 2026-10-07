import { useState } from "react";
import { Switch, Button, Alert } from "antd";
import {
  notificationsSupported,
  notificationPermission,
  desktopNotificationsEnabled,
  enableDesktopNotifications,
  disableDesktopNotifications,
  callSoundEnabled,
  setCallSoundEnabled
} from "../features/notifications/notify";

const rowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap"
};

// Per-device notification preferences (shown in #bot-settings)
function NotificationSettings() {
  const [desktopOn, setDesktopOn] = useState(desktopNotificationsEnabled);
  const [permission, setPermission] = useState(notificationPermission);
  const [soundOn, setSoundOn] = useState(callSoundEnabled);

  async function toggleDesktop(checked) {
    if (!checked) {
      disableDesktopNotifications();
      setDesktopOn(false);
      return;
    }
    const result = await enableDesktopNotifications();
    setPermission(result);
    setDesktopOn(result === "granted");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={rowStyle}>
        <div>
          <div style={{ fontWeight: 600, color: "var(--text)" }}>Desktop notifications</div>
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Direct messages, @mentions and incoming calls when you&apos;re not looking at the app.
          </div>
        </div>
        {notificationsSupported() ? (
          <Switch
            checked={desktopOn}
            onChange={toggleDesktop}
            disabled={permission === "denied"}
            aria-label="Desktop notifications"
          />
        ) : (
          <Button size="small" disabled>
            Not supported
          </Button>
        )}
      </div>
      {permission === "denied" && (
        <Alert
          type="warning"
          showIcon
          title="Notifications are blocked for this site"
          description="Allow them in your browser's site settings (the icon left of the address bar), then reload."
        />
      )}

      <div style={rowStyle}>
        <div>
          <div style={{ fontWeight: 600, color: "var(--text)" }}>Ring for incoming calls</div>
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Play a ringtone when someone calls you or starts a huddle.
          </div>
        </div>
        <Switch
          checked={soundOn}
          onChange={(checked) => {
            setCallSoundEnabled(checked);
            setSoundOn(checked);
          }}
          aria-label="Ring for incoming calls"
        />
      </div>
    </div>
  );
}

export default NotificationSettings;
