// The first-use Codex download. Settings and a Trunk's model choice both call
// codex.runtime.download, which is the engine's on-demand downloader
// (engine/extensions/codex/src/codex-runtime.ts). There is no second downloader.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { canAll } from "../../../connect/capabilities";
import type { RecordValue } from "../adapter";

export const CODEX_RUNTIME_METHOD = "codex.runtime";
export const CODEX_DOWNLOAD_METHOD = "codex.runtime.download";

export type CodexGet = {
  /** Get Codex before the download; Try again after it fails. */
  action?: "Get Codex" | "Try again";
  /** Plain progress or failure line from the engine. */
  line?: string;
  ready: boolean;
};

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

/** Reads codex.runtime while active, and starts the same download the engine uses on a Codex turn. */
export function useCodexDownload(engine: WindowEngine | undefined, active: boolean) {
  const [runtime, setRuntime] = useState<RecordValue>();
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
  const start = useCallback(async () => {
    if (!engine) return;
    try {
      setRuntime(await engine.request<RecordValue>(CODEX_DOWNLOAD_METHOD, {}));
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Codex couldn’t be downloaded. Try again.";
      setRuntime({ state: "unavailable", reason: "download-failed", message: message.includes("Try again") ? message : `${message} Try again.` });
    }
  }, [engine]);
  return { view: active ? codexGetView(runtime) : undefined, start };
}

/** True when this engine can start the first-use download. */
export function codexDownloadOffered(engine: WindowEngine | undefined): boolean {
  return canAll(engine, [CODEX_RUNTIME_METHOD, CODEX_DOWNLOAD_METHOD]);
}
