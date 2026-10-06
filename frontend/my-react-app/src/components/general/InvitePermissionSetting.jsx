import { useState } from "react";
import { Switch, Alert } from "antd";
import { useDispatch, useSelector } from "react-redux";
import { updateSettings } from "../../features/general/generalSlice";

// "Members can invite people": the owner can toggle it, everyone else sees it
function InvitePermissionSetting({ currentMember }) {
  const dispatch = useDispatch();
  const membersCanInvite = useSelector((state) => state.general.settings.membersCanInvite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isOwner = currentMember?.role === "owner";

  async function handleChange(checked) {
    setSaving(true);
    setError(null);
    try {
      await dispatch(updateSettings({ membersCanInvite: checked })).unwrap();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <div style={{ fontWeight: 600, color: "#1D1C1D" }}>Members can invite people</div>
          <div style={{ fontSize: "12px", color: "#868686" }}>
            {membersCanInvite
              ? "Anyone in the workspace can send invites."
              : "Only the workspace owner can send invites."}
            {!isOwner && " Only the owner can change this."}
          </div>
        </div>
        <Switch
          checked={membersCanInvite}
          onChange={handleChange}
          loading={saving}
          disabled={!isOwner}
          aria-label="Members can invite people"
        />
      </div>
      {error && <Alert type="error" showIcon title={error} style={{ marginTop: "10px" }} />}
    </div>
  );
}

export default InvitePermissionSetting;
