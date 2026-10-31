// The first-use Codex download. Settings, a Trunk's model choice and a waiting
// Codex turn all ask with the same size question before codex.runtime.download
// fetches anything. Declining does not download. There is no second downloader
// and no second prompt.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { canAll } from "../../../connect/capabilities";
import type { RecordValue } from "../adapter";

export const CODEX_RUNTIME_METHOD = "codex.runtime";
export const CODEX_DOWNLOAD_METHOD = "codex.runtime.download";
export const CODEX_CANCEL_METHOD = "codex.runtime.cancel";

export type CodexGet = {
  /** Get Codex before the download; Try again after it fails. */
  action?: "Get Codex" | "Try again";
  /** Plain progress or failure line from the engine. */
  line?: string;
  ready: boolean;
};

const BANNED = /isn['’]t needed/i;

/** The size question shown before any Codex byte is fetched. */
export function codexPromptMessage(runtime: RecordValue | undefined): string {
  const ask = typeof runtime?.ask === "string" ? runtime.ask.trim() : "";
  if (ask && !BANNED.test(ask)) return ask;
  const version = typeof runtime?.version === "string" ? runtime.version.trim() : "";
  const bytes = typeof runtime?.bytes === "number" && runtime.bytes > 0 ? runtime.bytes : 0;
  if (bytes > 0) {
    const size = `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
    return version ? `Download Codex ${version} (${size})?` : `Download Codex (${size})?`;
  }
  const message = typeof runtime?.message === "string" ? runtime.message.trim() : "";
  if (message.includes("?") && /\d+\s*MB/i.test(message) && !BANNED.test(message)) return message;
  return "Download Codex?";
}

/** What the row or the conversation shows for one codex.runtime answer. */
export function codexGetView(runtime: RecordValue | undefined): CodexGet | undefined {
  if (!runtime) return undefined;
  const state = typeof runtime.state === "string" ? runtime.state : "";
  const message = typeof runtime.message === "string" ? runtime.message.trim() : "";
  if (state === "ready") return { ready: true };
  if (state === "downloading") return { ready: false, line: message || "Getting Codex ready…" };
  if (state === "unavailable") {
    return {
      ready: false,
      line: message || "Codex couldn’t be downloaded. Try again.",
      ...(runtime.reason === "unsupported-platform" ? {} : { action: "Try again" as const }),
    };
  }
  if (state === "download") return { ready: false, action: "Get Codex" };
  return undefined;
}

/** Reads codex.runtime while active. The download starts only after Yes. */
export function useCodexDownload(engine: WindowEngine | undefined, active: boolean) {
  const [runtime, setRuntime] = useState<RecordValue>();
  const [asking, setAsking] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active || !engine) return;
    let live = true;
    engine.request<RecordValue>(CODEX_RUNTIME_METHOD, {}).then(
      (next) => { if (live) setRuntime(next); },
      () => { if (live) setRuntime(undefined); },
    );
    return () => { live = false; };
  }, [engine, active, tick]);
  const downloading = runtime?.state === "downloading";
  useEffect(() => {
    if (!downloading) return;
    const id = setTimeout(() => setTick((n) => n + 1), 1000);
    return () => clearTimeout(id);
  }, [downloading, runtime]);
  const requestPrompt = useCallback(() => {
    setAsking(true);
  }, []);
  const accept = useCallback(async () => {
    if (!engine) return;
    try {
      setRuntime(await engine.request<RecordValue>(CODEX_DOWNLOAD_METHOD, { confirmed: true }));
      setAsking(false);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Codex couldn’t be downloaded. Try again.";
      setRuntime({ state: "unavailable", reason: "download-failed", message: message.includes("Try again") ? message : `${message} Try again.` });
      setAsking(false);
    }
  }, [engine]);
  const decline = useCallback(async () => {
    setAsking(false);
    if (!engine) return;
    try {
      const next = await engine.request<RecordValue>(CODEX_CANCEL_METHOD, {});
      if (next && typeof next.state === "string") setRuntime(next);
    } catch {
      // Declining never downloads. A missing cancel call still leaves Codex unfetched.
    }
  }, [engine]);
  const view = active ? codexGetView(runtime) : undefined;
  return { view, prompt: asking ? codexPromptMessage(runtime) : undefined, requestPrompt, accept, decline };
}

/** True when this engine can start the first-use download. */
export function codexDownloadOffered(engine: WindowEngine | undefined): boolean {
  return canAll(engine, [CODEX_RUNTIME_METHOD, CODEX_DOWNLOAD_METHOD]);
}
