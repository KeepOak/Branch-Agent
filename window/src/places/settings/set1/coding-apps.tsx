// Accounts › Coding apps on this computer (§4.7.8): Claude Code, Codex and Gemini CLI as branch.setup.detect finds
// them. Codex runs through the engine's codex plugin, so its switch is plugins.entries.codex.enabled; the other
// two follow their own sign-in on this computer.
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Sec, Switch, useConfig, useScope } from "../kit";
import { Logo } from "./service";

type App = { kind: string; brand: string; name: string; plugin?: string };
const APPS: App[] = [
  { kind: "claude-cli", brand: "anthropic", name: "Claude Code" },
  { kind: "codex-cli", brand: "openai", name: "Codex", plugin: "codex" },
  { kind: "gemini-cli", brand: "google", name: "Gemini CLI" },
];
type Found = { state: "ready" | "signin" | "missing"; reason?: string; viaSignIn?: boolean };

/** Codex needs no app when a ChatGPT sign-in is already saved: the models answer through that sign-in. */
export function foundState(app: App, detect: RecordValue | undefined, signedInChatGPT = false): Found {
  const hit = list(detect?.candidates).find((c) => c.kind === app.kind);
  if (hit) return { state: hit.credentials === false ? "signin" : "ready" };
  if (app.kind === "codex-cli" && signedInChatGPT) return { state: "ready", viaSignIn: true };
  const gone = list(detect?.unavailableCandidates).find((c) => text(c.id).includes(app.kind) || text(c.id).includes(app.kind.replace("-cli", "")));
  return { state: "missing", reason: gone ? visible(gone.reason) : undefined };
}

const PILL: Record<Found["state"], [string, string]> = { ready: ["ok", "Models ready"], signin: ["warn", "Sign-in needed"], missing: ["idle", "Not found"] };

function sub(app: App, f: Found, on: boolean): string {
  if (f.viaSignIn) return "Models ready through your ChatGPT sign-in. The Codex app isn’t needed.";
  if (f.state === "missing") return f.reason ?? `Install and sign in to ${app.name} on this computer, then check again.`;
  if (f.state === "signin") return `Open ${app.name} and check its sign-in, then check again.`;
  return on ? `On because ${app.name} is connected on this computer.` : `${app.name} is connected on this computer. Turn it on to use its models.`;
}

export function CodingApps({ engine }: { engine: WindowEngine }) {
  const scope = useScope();
  const detect = useResource<RecordValue>(engine, "branch.setup.detect", scope ? { agentId: scope } : {});
  const usage = useResource<RecordValue>(engine, "usage.status");
  const accounts = useResource<RecordValue>(engine, "models.authStatus", scope ? { agentId: scope } : {});
  const signedInChatGPT = list(accounts.data?.providers).some((p) => p.provider === "openai" && list(p.profiles).some((x) => x.status === "ok"));
  const claude = list(usage.data?.providers).find((row) => row.provider === "claude-code");
  const cfg = useConfig(engine);
  return (
    <Sec title="Coding apps on this computer" hint="Each app keeps its own account and permissions." help="Each app keeps its own account and permissions. Turning one on doesn’t sign you in.">
      {APPS.map((app) => {
        const f = foundState(app, detect.data, signedInChatGPT);
        const [tone, word] = detect.loading ? ["idle", "Looking…"] : PILL[f.state];
        const pluginOn = app.plugin ? cfg.get(`plugins.entries.${app.plugin}.enabled`) === true : f.state === "ready";
        return (
          <Ctl key={app.kind} id={app.name} title={<>{app.name}{app.kind === "claude-cli" && claude?.accountEmail ? ` · ${text(claude.accountEmail)}` : ""}<span className={`pill ${tone}`}><i />{word}</span></>} icon={<Logo id={app.brand} size={22} />} sub={detect.loading ? "Looking on this computer…" : sub(app, f, pluginOn)}>
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
