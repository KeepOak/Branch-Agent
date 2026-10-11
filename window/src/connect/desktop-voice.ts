import { useEffect, useState } from "react";

export type DesktopVoiceSettings = {
  listening: "off" | "push-to-talk" | "wake-word";
  shortcut: string;
  microphone: string;
  dictation: boolean;
};
export type DesktopVoiceBridge = {
  get(): Promise<DesktopVoiceSettings>;
  set(settings: DesktopVoiceSettings): Promise<DesktopVoiceSettings>;
  requestMicrophone(): Promise<void>;
  onAction(listener: () => void): () => void;
  onChanged(listener: (settings: DesktopVoiceSettings) => void): () => void;
};
export function desktopVoice(): DesktopVoiceBridge | undefined {
  return (window as unknown as { branchDesktop?: { voice?: DesktopVoiceBridge } }).branchDesktop?.voice;
}

export function useDesktopVoice() {
  const bridge = desktopVoice();
  const [state, setState] = useState<DesktopVoiceSettings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const off = bridge.onChanged(next => { if (live) setState(next); });
    void bridge.get().then(next => { if (live) setState(next); }, e => { if (live) setError(String(e)); });
    return () => { live = false; off(); };
  }, [bridge]);
  const set = async (patch: Partial<DesktopVoiceSettings>) => {
    if (!bridge || !state) return;
    setError("");
    try { setState(await bridge.set({ ...state, ...patch })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return { bridge, state, error, set };
}

/** The selected device is shared by live talk, dictation, wake listening and the microphone test. */
export async function voiceMicrophone(): Promise<MediaStream> {
  const bridge = desktopVoice();
  if (bridge) await bridge.requestMicrophone();
  const device = bridge ? (await bridge.get()).microphone : "";
  return navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: true, noiseSuppression: true,
    ...(device ? { deviceId: { exact: device } } : {}),
  } });
}
