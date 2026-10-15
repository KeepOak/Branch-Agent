// "GitHub account for new work" on a Trunk's What it may do tab (preview 30-trunks mayHTMLC18, Advanced). The choices call
// the same engine methods the Settings GitHub card used for this one Trunk (scope "agent"): Same as Branch is
// tools.github.configure with mode inherit, Its own is tools.github.authorize start / poll / cancel. "This computer’s GitHub"
// has no per-Trunk call (inherit already resolves to the computer's sign-in when no shared account is set), so it stays greyed.
import { useEffect, useState } from "react";
import { Coming } from "../../glass/coming";
import type { WindowEngine } from "../../connect/engine";
import { GitHubConnection } from "../settings/github-connection";

const COMPUTER_WHY = "This computer’s GitHub comes in a later update.";

function DeviceCode({ conn }: { conn: GitHubConnection }) {
  const { device, expiresAt, phase } = conn.view;
  if (!device) return null;
  return <div role="status" className="status bs-alert">
    <div className="grow">
      <b>Enter <strong>{device.userCode}</strong> on GitHub.</b>
      <p><a href="https://github.com/login/device" target="_blank" rel="noopener noreferrer">Open GitHub sign-in</a> · Code expires {expiresAt ? new Date(expiresAt).toLocaleTimeString() : ""} · {phase.replaceAll("_", " ")}</p>
    </div>
  </div>;
}

function Choices({ conn, admin, own, ownIdentity, busy }: { conn: GitHubConnection | null; admin: boolean; own: boolean; ownIdentity: boolean; busy: boolean }) {
  const pending = Boolean(conn?.view.device);
  return <span className="tk-seg" role="group" aria-label="GitHub account for new work">
    <button type="button" aria-pressed={!own} disabled={!admin || busy || !own || !conn} onClick={() => void conn?.inherit()}>Same as Branch</button>
    <Coming need="tools.github.configure" unwired reason={COMPUTER_WHY}><button type="button" aria-pressed={false} disabled>This computer’s GitHub</button></Coming>
    {pending
      ? <button type="button" disabled={!conn} onClick={() => void conn?.cancel()}>Cancel sign-in</button>
      : <button type="button" aria-pressed={ownIdentity} disabled={!admin || busy || !conn} onClick={() => void conn?.start()}>Its own</button>}
  </span>;
}

export function GitHubChoice({ engine, agentId }: { engine: WindowEngine; agentId: string }) {
  const [, redraw] = useState(0);
  const [conn, setConn] = useState<GitHubConnection | null>(null);
  useEffect(() => {
    const controller = new GitHubConnection(engine, agentId, "agent", () => redraw((n) => n + 1));
    setConn(controller);
    void controller.refresh();
    return () => controller.dispose();
  }, [engine, agentId]);
  const view = conn?.view;
  const status = view?.status ?? null;
  const identity = status?.effective ?? null;
  const admin = engine.scopes.includes("operator.admin");
  const own = Boolean(status?.selected.configured);
  const ownIdentity = own && identity?.source === "agent-override";
  const busy = !conn || Boolean(view?.busy) || view?.phase === "loading";
  const account = identity?.account ? `@${identity.account.login}` : view?.phase === "loading" || !view ? "Reading connection…" : "Not connected";
  return <div className="tk-ctl">
    <b>GitHub account for new work</b>
    <span className="tk-right"><Choices conn={conn} admin={admin} own={own} ownIdentity={ownIdentity} busy={busy} /></span>
    <small>Which GitHub account this Trunk’s new work signs in with.</small>
    <small className="tk-why">{COMPUTER_WHY}</small>
    {conn && <DeviceCode conn={conn} />}
    <small>{account}{identity ? ` · ${identity.credentialState.replaceAll("_", " ")}` : ""}</small>
    {identity && <small>Permissions: {identity.oauthScopes.length ? identity.oauthScopes.join(", ") : "No scopes reported"}</small>}
    {view?.error && <p role="alert" className="hint">{view.error}</p>}
    {!admin && <p className="hint">Only someone who may change Branch’s setup can connect or remove a shared account.</p>}
  </div>;
}
