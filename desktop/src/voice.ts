import { readFileSync, writeFileSync } from "node:fs";

export type VoiceSettings = {
  listening: "off" | "push-to-talk" | "wake-word";
  shortcut: string;
  microphone: string;
  dictation: boolean;
};
export const voiceDefaults: VoiceSettings = { listening: "off", shortcut: "CommandOrControl+Shift+Space", microphone: "", dictation: true };

export function voiceSettings(value: unknown): VoiceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid voice settings");
  const v = value as Record<string, unknown>;
  if (!['off', 'push-to-talk', 'wake-word'].includes(String(v.listening)) || typeof v.shortcut !== "string"
    || !/^(?:(?:CommandOrControl|Control|Alt|Shift|Super|Command)\+)+(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(v.shortcut)
    || typeof v.microphone !== "string" || v.microphone.length > 1024 || typeof v.dictation !== "boolean") throw new Error("Invalid voice settings");
  return { listening: v.listening as VoiceSettings['listening'], shortcut: v.shortcut, microphone: v.microphone, dictation: v.dictation };
}

/** Audio only, from the owned top-level page. No camera, iframe, or external-page grants. */
export function mayUseMicrophone(owned: boolean, served: string, url: string, mainFrame: boolean, media: string[]): boolean {
  return owned && mainFrame && url.startsWith(served) && media.length > 0 && media.every(type => type === "audio");
}

export function createVoiceController(deps: {
  file: string;
  shortcuts: { register(key: string, action: () => void): boolean; unregister(key: string): void };
  action(): void;
  changed(settings: VoiceSettings): void;
}) {
  let state = { ...voiceDefaults };
  try { state = voiceSettings(JSON.parse(readFileSync(deps.file, "utf8"))); } catch { /* first launch uses off */ }
  let registered = "";
  const bind = (next: VoiceSettings) => {
    const key = next.listening === "push-to-talk" && next.dictation ? next.shortcut : "";
    if (key === registered) return;
    if (key && !deps.shortcuts.register(key, deps.action)) throw new Error("That shortcut is unavailable. Choose another push-to-talk key.");
    if (registered) deps.shortcuts.unregister(registered);
    registered = key;
  };
  return {
    get: () => ({ ...state }),
    apply: () => bind(state),
    set(value: unknown) {
      const next = voiceSettings(value);
      bind(next);
      try { writeFileSync(deps.file, JSON.stringify(next), { mode: 0o600 }); }
      catch (error) { bind(state); throw error; }
      state = next;
      deps.changed({ ...state });
      return { ...state };
    },
    dispose() { if (registered) deps.shortcuts.unregister(registered); registered = ""; },
  };
}
