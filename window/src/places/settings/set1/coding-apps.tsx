// Accounts › Coding apps on this computer (§4.7.8): a local CLI probe, separate from provider setup discovery.
// them. Codex runs through the engine's codex plugin, so its switch is plugins.entries.codex.enabled; the other
// two follow their own sign-in on this computer.
import type { WindowEngine } from "../../../connect/engine";
import { list, text, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Sec, Switch, useConfig } from "../kit";
import { Logo } from "./service";

type App = { kind: string; brand: string; name: string; plugin?: string };
const APPS: App[] = [
  { kind: "claude-cli", brand: "anthropic", name: "Claude Code" },
  { kind: "codex-cli", brand: "openai", name: "Codex", plugin: "codex" },
  { kind: "gemini-cli", brand: "google", name: "Gemini CLI" },
];
type Found = { state: "ready" | "signin" | "unverified" | "missing"; reason?: string };

export function foundState(app: App, detect: RecordValue | undefined): Found {
  const hit = list(detect?.apps).find((c) => c.kind === app.kind);
  if (!hit?.installed) return { state: "missing" };
  return { state: hit.credentials === true ? "ready" : hit.credentials === false ? "signin" : "unverified" };
}

const PILL: Record<Found["state"], [string, string]> = { ready: ["ok", "Models ready"], signin: ["warn", "Sign-in needed"], unverified: ["idle", "Installed"], missing: ["idle", "Not detected"] };

function sub(app: App, f: Found, on: boolean): string {
  if (f.state === "missing") return f.reason ?? `Install and sign in to ${app.name} on this computer, then check again.`;
  if (f.state === "signin") return `Open ${app.name} and check its sign-in, then check again.`;
  if (f.state === "unverified") return `${app.name} is installed on this computer; check its sign-in in the app.`;
  return on ? `On because ${app.name} is connected on this computer.` : `${app.name} is connected on this computer. Turn it on to use its models.`;
}

export function CodingApps({ engine }: { engine: WindowEngine }) {
  const detect = useResource<RecordValue>(engine, "branch.setup.codingApps");
  const usage = useResource<RecordValue>(engine, "usage.status");
  const claude = list(usage.data?.providers).find((row) => row.provider === "claude-code");
  const cfg = useConfig(engine);
  return (
    <Sec title="Coding apps on this computer" hint="Each app keeps its own account and permissions." help="Each app keeps its own account and permissions. Turning one on doesn’t sign you in.">
      {APPS.map((app) => {
        const f = foundState(app, detect.data);
        const [tone, word] = detect.loading ? ["idle", "Looking…"] : detect.error ? ["warn", "Check failed"] : PILL[f.state];
        const pluginOn = app.plugin ? cfg.get(`plugins.entries.${app.plugin}.enabled`) === true : f.state === "ready";
        return (
          <Ctl key={app.kind} id={app.name} title={<>{app.name}{app.kind === "claude-cli" && claude?.accountEmail ? ` · ${text(claude.accountEmail)}` : ""}<span className={`pill ${tone}`}><i />{word}</span></>} icon={<Logo id={app.brand} size={22} />} sub={detect.loading ? "Looking on this computer…" : detect.error ? `Couldn’t check this computer: ${detect.error}` : sub(app, f, pluginOn)}>
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
