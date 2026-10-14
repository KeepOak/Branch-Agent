// Accounts › Coding apps on this computer (§4.7.8): Claude Code, Codex and Gemini CLI as branch.setup.detect finds
// them. Codex runs through the engine's codex plugin, so its switch is plugins.entries.codex.enabled; the other
// two follow their own sign-in on this computer.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Sec, Switch, useConfig, useScope } from "../kit";
import { Logo } from "./service";

export type App = { kind: string; brand: string; name: string; plugin?: string };
export const APPS: App[] = [
  { kind: "claude-cli", brand: "anthropic", name: "Claude Code" },
  { kind: "codex-cli", brand: "openai", name: "Codex", plugin: "codex" },
  { kind: "gemini-cli", brand: "google", name: "Gemini CLI" },
];
export type Found = { state: "ready" | "signin" | "missing"; reason?: string };

export function foundState(app: App, detect: RecordValue | undefined): Found {
  const hit = list(detect?.candidates).find((c) => c.kind === app.kind);
  if (hit) return { state: hit.credentials === false ? "signin" : "ready" };
  const gone = list(detect?.unavailableCandidates).find((c) => text(c.id).includes(app.kind) || text(c.id).includes(app.kind.replace("-cli", "")));
  return { state: "missing", reason: gone ? visible(gone.reason) : undefined };
}

export const PILL: Record<Found["state"], [string, string]> = { ready: ["ok", "Models ready"], signin: ["warn", "Sign-in needed"], missing: ["idle", "Not found"] };

export function appSub(app: App, f: Found, on: boolean): string {
  if (f.state === "missing") return f.reason ?? `Install and sign in to ${app.name} on this computer, then check again.`;
  if (f.state === "signin") return `Open ${app.name} and check its sign-in, then check again.`;
  return on ? `On because ${app.name} is connected on this computer.` : `${app.name} is connected on this computer. Turn it on to use its models.`;
}

/** Codex's own runtime (codex.runtime). Release builds fetch Codex the first time it's used; while it isn't there the
 *  row says so, with the engine's reason (offline, a refused download), instead of failing quietly on the first turn. */
export type CodexRuntimeView = { tone: string; word: string; sub: string; action?: "Download now" | "Try again" };

export function codexRuntimeView(runtime: RecordValue | undefined): CodexRuntimeView | undefined {
  const state = typeof runtime?.state === "string" ? runtime.state : "";
  const message = typeof runtime?.message === "string" && runtime.message.trim() ? runtime.message.trim() : undefined;
  if (state === "download") return { tone: "idle", word: "Download", sub: message ?? "Codex downloads the first time you use it.", action: "Download now" };
  if (state === "downloading") return { tone: "idle", word: "Downloading…", sub: message ?? "Downloading Codex…" };
  if (state === "unavailable") {
    return { tone: "warn", word: "Not downloaded", sub: message ?? "Codex isn’t on this computer yet.", ...(runtime?.reason === "unsupported-platform" ? {} : { action: "Try again" as const }) };
  }
  return undefined;
}

/** codex.runtime while Codex is on, read again every 2 s during a download; download() starts it now. An engine without
 *  the call (older engines bundle Codex) shows nothing extra. */
export function useCodexRuntime(engine: WindowEngine, wanted: boolean) {
  const [runtime, setRuntime] = useState<RecordValue>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!wanted) { setRuntime(undefined); return; }
    let live = true;
    engine.request<RecordValue>("codex.runtime", {}).then((r) => { if (live) setRuntime(r); }, () => { if (live) setRuntime(undefined); });
    return () => { live = false; };
  }, [engine, wanted, tick]);
  const downloading = runtime?.state === "downloading";
  useEffect(() => {
    if (!downloading) return;
    const id = setTimeout(() => setTick((t) => t + 1), 2000);
    return () => clearTimeout(id);
  }, [downloading, runtime]);
  const download = async () => { setRuntime(await engine.request<RecordValue>("codex.runtime.download", {})); };
  return { view: wanted ? codexRuntimeView(runtime) : undefined, download };
}

export function CodingApps({ engine }: { engine: WindowEngine }) {
  const scope = useScope();
  const detect = useResource<RecordValue>(engine, "branch.setup.detect", scope ? { agentId: scope } : {});
  const usage = useResource<RecordValue>(engine, "usage.status");
  const claude = list(usage.data?.providers).find((row) => row.provider === "claude-code");
  const cfg = useConfig(engine);
  const codex = useCodexRuntime(engine, cfg.get("plugins.entries.codex.enabled") === true);
  return (
    <Sec title="Coding apps on this computer" hint="Each app keeps its own account and permissions." help="Each app keeps its own account and permissions. Turning one on doesn’t sign you in.">
      {APPS.map((app) => {
        const f = foundState(app, detect.data);
        const pluginOn = app.plugin ? cfg.get(`plugins.entries.${app.plugin}.enabled`) === true : f.state === "ready";
        const runtime = app.plugin === "codex" && pluginOn ? codex.view : undefined;
        const [tone, word] = runtime ? [runtime.tone, runtime.word] : detect.loading ? ["idle", "Looking…"] : PILL[f.state];
        return (
          <Ctl key={app.kind} id={app.name} title={<>{app.name}{app.kind === "claude-cli" && claude?.accountEmail ? ` · ${text(claude.accountEmail)}` : ""}<span className={`pill ${tone}`}><i />{word}</span></>} icon={<Logo id={app.brand} size={22} />} sub={runtime ? runtime.sub : detect.loading ? "Looking on this computer…" : appSub(app, f, pluginOn)}>
            {runtime?.action ? <Btn sm onClick={() => void codex.download()}>{runtime.action}</Btn> : null}
            {app.plugin
              ? <Switch checked={pluginOn} label={`Use ${app.name}`} disabled={cfg.loading} onChange={(v) => void cfg.set(`plugins.entries.${app.plugin}.enabled`, v)} />
              : <span title={`Follows ${app.name}’s own sign-in on this computer.`}><Switch checked={pluginOn} label={`Use ${app.name}`} disabled onChange={() => undefined} /></span>}
          </Ctl>
        );
      })}
      <div className="acts"><Btn sm disabled={detect.loading} onClick={() => void detect.reload()}>Check again</Btn></div>
    </Sec>
  );
}
