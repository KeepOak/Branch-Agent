// Accounts › Coding apps on this computer (§4.7.8): Claude Code, Codex and Gemini CLI as branch.setup.detect finds
// them. Codex runs through the engine's codex plugin, so its switch is plugins.entries.codex.enabled; the other
// two follow their own sign-in on this computer.
import { useEffect, useId, useMemo, useRef } from "react";
import { CheckedAt, useCheckedAt } from "../checked-at";
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Sec, Switch, useConfig, useLevel, useScope } from "../kit";
import { Coming } from "../../../glass/coming";
import { CODEX_DOWNLOAD_METHOD, codexDownloadOffered, useCodexDownload } from "./codex-get";
import { brandOf, Logo } from "./service";
import { plainError } from "../../../shell/plain-error";
import { plainCopy } from "../internals";

const SIGN_IN_ERROR = /token expired|\b401\b|\b403\b|unauthori[sz]ed|forbidden/i;

/** The detect read with its exact failure words kept beside it. Settings loaders store an already plain sentence
 *  for Regular, so the row keeps the raw words to spot a sign-in failure and to format them again at draw time. */
function useRawDetectError(engine: WindowEngine) {
  const raw = useRef<string | undefined>(undefined);
  const wrapped = useMemo<WindowEngine>(() => {
    const next = Object.create(engine) as WindowEngine;
    next.request = (async (method: string, params?: unknown) => {
      if (method === "branch.setup.detect") raw.current = undefined;
      try {
        return await engine.request(method, params);
      } catch (error) {
        if (method === "branch.setup.detect") raw.current = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }) as WindowEngine["request"];
    return next;
  }, [engine]);
  return [wrapped, raw] as const;
}

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

/** Why a switch that follows the app's own sign-in is greyed, on its own visible line. */
function followsWhy(app: App): string {
  return `Follows your sign-in in ${app.name} itself. Sign in or out there to change it.`;
}

/** A coding app's switch. When greyed it names its visible reason lines with aria-describedby, so a screen reader
 *  says why too (Switch takes no aria props, so the input gets it after render, as the kit's greyed rows do). */
function AppSwitch({ describedBy, ...props }: Parameters<typeof Switch>[0] & { describedBy: string }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const input = box.current?.querySelector("input");
    if (!input) return;
    if (props.disabled) input.setAttribute("aria-describedby", describedBy);
    else input.removeAttribute("aria-describedby");
  });
  return <span ref={box}><Switch {...props} /></span>;
}

export function CodingApps({ engine, caps = [], onSignIn }: { engine: WindowEngine; caps?: RecordValue[]; onSignIn?: (provider: string) => void }) {
  const [checked, stamp] = useCheckedAt();
  const scope = useScope();
  const level = useLevel();
  const [detectEngine, rawDetectError] = useRawDetectError(engine);
  const detect = useResource<RecordValue>(detectEngine, "branch.setup.detect", scope ? { agentId: scope } : {});
  const detectError = detect.error ? rawDetectError.current ?? detect.error : undefined;
  const usage = useResource<RecordValue>(engine, "usage.status");
  const claude = list(usage.data?.providers).find((row) => row.provider === "claude-code");
  const cfg = useConfig(engine);
  const codexApp = APPS.find((app) => app.plugin === "codex");
  const codexMissing = Boolean(codexApp) && !detect.loading && !detect.error && foundState(codexApp ?? APPS[0], detect.data).state !== "ready";
  const codex = useCodexDownload(engine, codexMissing && codexDownloadOffered(engine));
  const ids = useId();
  return (
    <Sec title="Coding apps on this computer" hint="Each app keeps its own account and permissions." help="Each app keeps its own account and permissions. Turning one on doesn’t sign you in.">
      {APPS.map((app) => {
        const signIn = onSignIn && caps.find((cap) => brandOf(text(cap.provider)) === app.brand && list(cap.loginOptions).some((option) => option.kind === "oauth" || option.kind === "device-code"));
        const authError = Boolean(detectError && SIGN_IN_ERROR.test(detectError));
        const f = foundState(app, detect.data);
        const getting = app.plugin === "codex" ? codex.view : undefined;
        const usable = f.state === "ready" || getting?.ready === true;
        const [tone, word] = detect.error ? ["idle", "Couldn’t check"] : detect.loading ? ["idle", "Looking…"] : PILL[f.state];
        const pluginOn = app.plugin ? cfg.get(`plugins.entries.${app.plugin}.enabled`) === true : f.state === "ready";
        const asking = app.plugin === "codex" ? codex.prompt : undefined;
        const sub = authError && !signIn && level === 0 ? `Open ${app.name} on this computer and sign in there, then choose Check again.` : asking ? asking : getting?.line ? getting.line : getting?.ready ? appSub(app, { state: "ready" }, pluginOn) : detectError ? plainError(detectError) : detect.loading ? "Looking on this computer…" : appSub(app, f, pluginOn);
        const subId = `${ids}${app.kind}-sub`;
        const whyId = `${ids}${app.kind}-why`;
        const line = <span id={subId}>{typeof sub === "string" ? plainCopy(sub, level) : sub}</span>;
        const tail = detect.error ? authError ? signIn ? <Btn sm onClick={() => onSignIn?.(text(signIn.provider))}>Sign in again</Btn> : undefined : <Btn sm onClick={() => void detect.reload()}>Check again</Btn> : asking ? <span data-testid="codex-download-prompt"><Coming need={CODEX_DOWNLOAD_METHOD} where="Download Codex"><Btn sm onClick={() => void codex.accept()}>Yes</Btn></Coming><Btn sm onClick={() => void codex.decline()}>Cancel</Btn></span> : getting?.action ? <Coming need={CODEX_DOWNLOAD_METHOD} where={getting.action}><Btn sm onClick={() => codex.requestPrompt()}>{getting.action}</Btn></Coming> : undefined;
        // Claude Code and Gemini CLI follow their own app's sign-in, so their switch is always greyed and says so.
        const after = app.plugin ? tail : <><small className="why-k" id={whyId}>{followsWhy(app)}</small>{tail}</>;
        return (
          <Ctl key={app.kind} id={app.name} title={<>{app.name}{app.kind === "claude-cli" && claude?.accountEmail ? ` · ${text(claude.accountEmail)}` : ""}<span className={`pill ${tone}`}><i />{word}</span></>} icon={<Logo id={app.brand} size={22} />} sub={line} after={after}>
            {app.plugin
              ? <AppSwitch describedBy={subId} checked={usable && pluginOn} label={`Use ${app.name}`} disabled={cfg.loading || !usable} onChange={(v) => void cfg.set(`plugins.entries.${app.plugin}.enabled`, v)} />
              : <AppSwitch describedBy={`${subId} ${whyId}`} checked={pluginOn} label={`Use ${app.name}`} disabled onChange={() => undefined} />}
          </Ctl>
        );
      })}
      <div className="acts"><Btn sm disabled={detect.loading} onClick={() => void detect.reload().then((ok) => { if (ok) stamp(); }, () => undefined)}>Check again</Btn><CheckedAt at={checked} /></div>
    </Sec>
  );
}
