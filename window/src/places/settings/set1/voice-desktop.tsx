import { useEffect, useRef, useState } from "react";
import { desktopVoice, useDesktopVoice, voiceMicrophone } from "../../../connect/desktop-voice";
import { Btn, Ctl, Switch } from "../kit";
import { APP, Choice } from "./voice-kit";

export function DesktopListening() {
  const { bridge, state, error, set } = useDesktopVoice();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [problem, setProblem] = useState("");
  const [shortcut, setShortcut] = useState("");
  useEffect(() => { setShortcut(state?.shortcut ?? ""); }, [state?.shortcut]);
  const refresh = async () => {
    try {
      const stream = await voiceMicrophone();
      stream.getTracks().forEach(t => t.stop());
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"));
      setProblem("");
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
  };
  const off = !bridge ? APP : undefined;
  return <>
    <Ctl title="Listening" off={off} sub="With a conversation open: push to talk starts dictation; press again to finish. Wake word listens while the conversation is focused and starts live talk. It keeps the microphone open and sends audio to your configured transcription service; both transcription and live voice must be connected.">
      <Choice label="Listening" value={state?.listening ?? "off"} disabled={!state}
        options={[{ id: "off", label: "Off" }, { id: "push-to-talk", label: "Push to talk" }, { id: "wake-word", label: "Wake word" }]}
        onChange={listening => void set({ listening: listening as "off" | "push-to-talk" | "wake-word" })} />
    </Ctl>
    <Ctl title="Push-to-talk key" stack off={off} sub="Works outside Branch and brings the conversation forward. Press again to put the words in the message box." after={error ? <small role="alert">{error}</small> : null}>
      <input className="inp" aria-label="Push-to-talk key" disabled={!state} value={shortcut} onChange={e => setShortcut(e.target.value)} />
      <Btn sm disabled={!state || shortcut === state.shortcut} onClick={() => void set({ shortcut })}>Save key</Btn>
    </Ctl>
    <Ctl title="Microphone" off={off} sub="Used for dictation, wake-word listening and live voice. Applies to the next recording." after={problem ? <small role="alert">{problem}</small> : null}>
      <select className="inp" aria-label="Microphone" disabled={!state} value={state?.microphone ?? ""} onChange={e => void set({ microphone: e.target.value })}>
        <option value="">System default</option>
        {state?.microphone && !devices.some(d => d.deviceId === state.microphone) ? <option value={state.microphone}>Selected microphone (refresh to check)</option> : null}
        {devices.filter(d => d.deviceId !== "default").map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
      </select>
      <Btn sm disabled={!state} onClick={() => void refresh()}>Refresh</Btn>
    </Ctl>
    <MicrophoneTest />
  </>;
}

export function DesktopDictation() {
  const { bridge, state, error, set } = useDesktopVoice();
  return <Ctl title="Dictation in the message box" off={!bridge ? APP : undefined} sub="The microphone button turns speech into text through your configured transcription service." after={error ? <small role="alert">{error}</small> : null}>
    <Switch label="Dictation in the message box" checked={state?.dictation ?? false} disabled={!state} onChange={dictation => void set({ dictation })} />
  </Ctl>;
}

export function MicrophoneTest() {
  const [level, setLevel] = useState<number | null>(null);
  const [error, setError] = useState("");
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const stop = () => { cancel.current?.(); cancel.current = null; setLevel(null); };
  const test = async () => {
    stop();
    setError("");
    let cancelled = false;
    cancel.current = () => { cancelled = true; };
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await voiceMicrophone();
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        setLevel(Math.min(1, Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length) * 4));
      }, 80);
      cancel.current = () => { cancelled = true; clearInterval(timer); source.disconnect(); stream?.getTracks().forEach(t => t.stop()); void context?.close(); };
      setLevel(0);
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      await context?.close().catch(() => undefined);
      if (!cancelled) { setLevel(null); setError(e instanceof Error ? e.message : String(e)); }
    }
  };
  return <Ctl title="Test the microphone" off={!desktopVoice() ? APP : undefined} sub="Watch the level as you speak. This test stays on your computer." after={error ? <small role="alert">{error}</small> : null}>
    {level !== null ? <meter aria-label="Microphone level" min={0} max={1} value={level} /> : null}
    <Btn sm disabled={!desktopVoice()} onClick={() => level === null ? void test() : stop()}>{level === null ? "Test" : "Stop"}</Btn>
  </Ctl>;
}
