// Accounts › Coding apps on this computer (§4.7.8): Claude Code, Codex and Gemini CLI as branch.setup.detect finds
// them. Codex runs through the engine's codex plugin, so its switch is plugins.entries.codex.enabled; the other
// two follow their own sign-in on this computer.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Sec, Status, Switch, useConfig, useScope } from "../kit";
import { Logo } from "./service";

type App = { kind: string; brand: string; name: string; plugin?: string };
const APPS: App[] = [
  { kind: "claude-cli", brand: "anthropic", name: "Claude Code" },
  { kind: "codex-cli", brand: "openai", name: "Codex", plugin: "codex" },
  { kind: "gemini-cli", brand: "google", name: "Gemini CLI" },
];
type Found = { state: "ready" | "signin" | "missing"; reason?: string };

export function foundState(app: App, detect: RecordValue | undefined): Found {
  const hit = list(detect?.candidates).find((c) => c.kind === app.kind);
  if (hit) return { state: hit.credentials === false ? "signin" : "ready" };
  const gone = list(detect?.unavailableCandidates).find((c) => text(c.id).includes(app.kind) || text(c.id).includes(app.kind.replace("-cli", "")));
  return { state: "missing", reason: gone ? visible(gone.reason) : undefined };
}

const PILL: Record<Found["state"], [string, string]> = { ready: ["ok", "Models ready"], signin: ["warn", "Sign-in needed"], missing: ["idle", "Not found"] };

function sub(app: App, f: Found, on: boolean): string {
  if (f.state === "missing") return f.reason ?? `Install and sign in to ${app.name} on this computer, then check again.`;
  if (f.state === "signin") return `Open ${app.name} and check its sign-in, then check again.`;
  return on ? `On because ${app.name} is connected on this computer.` : `${app.name} is connected on this computer. Turn it on to use its models.`;
}

export function CodingApps({ engine }: { engine: WindowEngine }) {
  const scope = useScope();
  const detect = useResource<RecordValue>(engine, "branch.setup.detect", scope ? { agentId: scope } : {});
  const usage = useResource<RecordValue>(engine, "usage.status");
  const claude = list(usage.data?.providers).find((row) => row.provider === "claude-code");
  const cfg = useConfig(engine);
  const [attempt, setAttempt] = useState(0);
  const [expired, setExpired] = useState(false);
  // Match setup's slow-response threshold. Late answers still replace the notice;
  // useResource ignores old responses after Check again starts a new generation.
  useEffect(() => {
    setExpired(false);
    if (!detect.loading) return;
    const timer = setTimeout(() => setExpired(true), 20_000);
    return () => clearTimeout(timer);
  }, [detect.loading, attempt, engine, scope]);
  const stuck = detect.loading && expired;
  const checking = detect.loading && !stuck;
  const checkAgain = () => { setAttempt((n) => n + 1); void detect.reload(); };
  return (
    <Sec title="Coding apps on this computer" hint="Each app keeps its own account and permissions." help="Each app keeps its own account and permissions. Turning one on doesn’t sign you in.">
      {checking ? <Status tone="idle" title="Looking for coding apps…">Checking this computer for Claude Code, Codex and Gemini CLI.</Status>
        : stuck ? <Status tone="warn" title="The check didn’t finish">This computer didn’t answer in 20 seconds. Check again to retry.</Status>
        : detect.error ? <Status tone="bad" title="Couldn’t check this computer">{visible(detect.error)}</Status>
        : APPS.map((app) => {
        const f = foundState(app, detect.data);
        const [tone, word] = PILL[f.state];
        const pluginOn = app.plugin ? cfg.get(`plugins.entries.${app.plugin}.enabled`) === true : f.state === "ready";
        return (
          <Ctl key={app.kind} id={app.name} title={<>{app.name}{app.kind === "claude-cli" && claude?.accountEmail ? ` · ${text(claude.accountEmail)}` : ""}<span className={`pill ${tone}`}><i />{word}</span></>} icon={<Logo id={app.brand} size={22} />} sub={sub(app, f, pluginOn)}>
            {app.plugin
              ? <Switch checked={pluginOn} label={`Use ${app.name}`} disabled={cfg.loading} onChange={(v) => void cfg.set(`plugins.entries.${app.plugin}.enabled`, v)} />
              : <span title={`Follows ${app.name}’s own sign-in on this computer.`}><Switch checked={pluginOn} label={`Use ${app.name}`} disabled onChange={() => undefined} /></span>}
          </Ctl>
        );
      })}
      <div className="acts"><Btn sm disabled={checking} onClick={checkAgain}>Check again</Btn></div>
    </Sec>
  );
}
