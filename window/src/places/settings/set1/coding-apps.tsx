// Accounts › Coding apps on this computer (§4.7.8): Claude Code, Codex and Gemini CLI as branch.setup.detect finds
// them. Codex runs through the engine's codex plugin, so its switch is plugins.entries.codex.enabled; the other
// two follow their own sign-in on this computer.
import { CheckedAt, useCheckedAt } from "../checked-at";
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
  // §4.7.8: an app that isn't installed always reads the same; Codex turns fail with this sentence too.
  if (f.state === "missing") return `Install and sign in to ${app.name} on this computer, then check again.`;
  if (f.state === "signin") return `Open ${app.name} and check its sign-in, then check again.`;
  return on ? `On because ${app.name} is connected on this computer.` : `${app.name} is connected on this computer. Turn it on to use its models.`;
}

export function CodingApps({ engine }: { engine: WindowEngine }) {
  const [checked, stamp] = useCheckedAt();
  const scope = useScope();
  const detect = useResource<RecordValue>(engine, "branch.setup.detect", scope ? { agentId: scope } : {});
  const usage = useResource<RecordValue>(engine, "usage.status");
  const claude = list(usage.data?.providers).find((row) => row.provider === "claude-code");
  const cfg = useConfig(engine);
  return (
    <Sec title="Coding apps on this computer" hint="Each app keeps its own account and permissions." help="Each app keeps its own account and permissions. Turning one on doesn’t sign you in.">
      {APPS.map((app) => {
        const f = foundState(app, detect.data);
        const [tone, word] = detect.error ? ["idle", "Couldn’t check"] : detect.loading ? ["idle", "Looking…"] : PILL[f.state];
        const pluginOn = app.plugin ? cfg.get(`plugins.entries.${app.plugin}.enabled`) === true : f.state === "ready";
        return (
          <Ctl key={app.kind} id={app.name} title={<>{app.name}{app.kind === "claude-cli" && claude?.accountEmail ? ` · ${text(claude.accountEmail)}` : ""}<span className={`pill ${tone}`}><i />{word}</span></>} icon={<Logo id={app.brand} size={22} />} subWhy={!app.plugin || f.state !== "ready"} sub={detect.error ? visible(detect.error) : detect.loading ? "Looking on this computer…" : appSub(app, f, pluginOn)} after={detect.error ? <Btn sm onClick={() => void detect.reload()}>Try again</Btn> : undefined}>
            {app.plugin
              ? <Switch checked={f.state === "ready" && pluginOn} label={`Use ${app.name}`} disabled={cfg.loading || f.state !== "ready"} onChange={(v) => void cfg.set(`plugins.entries.${app.plugin}.enabled`, v)} />
              : <span title={`Follows ${app.name}’s own sign-in on this computer.`}><Switch checked={pluginOn} label={`Use ${app.name}`} disabled onChange={() => undefined} /></span>}
          </Ctl>
        );
      })}
      <div className="acts"><Btn sm disabled={detect.loading} onClick={() => void detect.reload().then((ok) => { if (ok) stamp(); }, () => undefined)}>Check again</Btn><CheckedAt at={checked} /></div>
    </Sec>
  );
}
