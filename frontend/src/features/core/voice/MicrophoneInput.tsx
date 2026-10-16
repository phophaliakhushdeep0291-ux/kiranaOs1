import { useEffect, useId, useState } from "react";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { selectedMicrophone, selectMicrophone, type MicrophoneFeedback } from "./microphone-input";

// Cloud capture requires connectivity. Keep this optional panel out of the
// offline counter's static dependency graph; native packages still bundle it.
export default function MicrophoneInput({ busy, input }: { busy: boolean; input: MicrophoneFeedback | null }) {
  const { t } = useAppLanguage();
  const id = useId();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(selectedMicrophone);
  useEffect(() => {
    let active = true;
    const media = navigator.mediaDevices;
    const refresh = async () => {
      try {
        const found = await media?.enumerateDevices();
        if (active) setDevices((found || []).filter(device => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default" && device.deviceId !== "communications"));
      } catch { /* Leave the system default available when enumeration is denied. */ }
    };
    void refresh();
    media?.addEventListener?.("devicechange", refresh);
    return () => { active = false; media?.removeEventListener?.("devicechange", refresh); };
  }, [busy, input?.deviceName]);
  return <div className="mt-2 space-y-1 text-xs">
    <label htmlFor={id}>{t("assistant.microphoneInput")}</label>
    <select id={id} className="min-h-9 w-full rounded-md border bg-background px-2 text-foreground" disabled={busy} value={selected} onChange={event => { setSelected(event.target.value); selectMicrophone(event.target.value); }}>
      <option value="">{t("assistant.microphoneDefault")}</option>
      {selected && !devices.some(device => device.deviceId === selected) && <option value={selected}>{t("assistant.microphoneDisconnected")}</option>}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t("assistant.microphoneInput")} ${index + 1}`}</option>)}
    </select>
    {input && <div className="space-y-1" data-microphone-feedback="true">
      <p>{t("assistant.microphoneRecording", { name: input.deviceName || t("assistant.microphoneDefault"), seconds: input.elapsedSeconds })}</p>
      {input.level !== null && <meter aria-label={t("assistant.microphoneInput")} className="h-3 w-full" min={0} max={100} value={input.level} />}
      <p className="text-muted-foreground">{t("assistant.microphoneHelp")}</p>
    </div>}
  </div>;
}
