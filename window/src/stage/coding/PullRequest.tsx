import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { SIcon } from "../stage-icons";

type Account = { accountId: number; login: string };
type Publisher = { source: string } & Account;
type Result =
  | { status: "requested" | "publishing" | "needs_confirmation"; requestId: string; message: string; publisher?: Publisher }
  | { status: "published"; requestId: string; url: string; repository: string; branch: string; headCommit: string; publisher?: Publisher }
  | { status: "failed"; requestId: string; code: string; message: string; nextAction: string; publisher?: Publisher };
type Confirmation = { requestDigest: string; generation: string; account: Account; repository: string; branch: string; baseBranch: string } | null;
type Options = {
  personal: { state: string; generation: string | null; account: Account | null } | null;
  shared: Publisher | null;
  pendingPersonal: { result: Result; confirmation: Confirmation } | null;
  latestShared: { result: Result; confirmation: Confirmation } | null;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const done = (r: Result | null) => r?.status === "published" || r?.status === "failed";

/** The pull request a conversation opened: repository, branch and a link to it on GitHub. */
export function PullRequestCard({ result }: { result: Extract<Result, { status: "published" }> }) {
  return (
    <div className="pr-card-cd">
      <SIcon name="branch" small />
      <span className="grow">
        <b>Pull request opened</b>
        <small>
          {result.repository} · {result.branch} · {result.headCommit.slice(0, 7)}
        </small>
      </span>
      <a className="btn sm" href={result.url} target="_blank" rel="noreferrer">
        Open on GitHub
      </a>
    </div>
  );
}

/** Open a pull request (sessions.github.options / publish / status / confirm), as the shared or your own GitHub account. */
export function PullRequestBox({ engine, hasChanges }: { engine: WindowEngine; hasChanges: boolean }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    engine.request<Options>("sessions.github.options", { sessionKey: engine.sessionKey }).then(
      (o) => {
        if (!live) return;
        setOptions(o);
        const pending = o.pendingPersonal ?? o.latestShared;
        if (pending && !done(pending.result)) {
          setResult(pending.result);
          setConfirmation(pending.confirmation);
        }
      },
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [engine]);
  // While GitHub is working on it, read its status again (it settles on published or failed).
  useEffect(() => {
    if (!result || done(result) || result.status === "needs_confirmation") return;
    const t = setTimeout(() => {
      engine.request<{ result: Result; confirmation: Confirmation }>("sessions.github.status", { sessionKey: engine.sessionKey, requestId: result.requestId }).then(
        (s) => {
          setResult(s.result);
          setConfirmation(s.confirmation);
        },
        (e: unknown) => setError(errorText(e)),
      );
    }, 2000);
    return () => clearTimeout(t);
  }, [engine, result]);
  const personal = options?.personal?.state === "connected" && options.personal.generation && options.personal.account ? { source: "personal" as const, generation: options.personal.generation, account: options.personal.account } : null;
  const selection = options?.shared ? { source: "shared" as const, expected: options.shared } : personal;
  const who = options?.shared ? options.shared.login : personal?.account.login;
  const publish = () => {
    if (!selection) return;
    setBusy(true);
    setError("");
    attempt.current ??= crypto.randomUUID();
    engine
      .request<Result>("sessions.github.publish", { sessionKey: engine.sessionKey, idempotencyKey: attempt.current, selection, ...(title.trim() ? { title: title.trim() } : {}), ...(body.trim() ? { body: body.trim() } : {}) })
      .then(
        async (r) => {
          setResult(r);
          if (r.status === "needs_confirmation") {
            const s = await engine.request<{ result: Result; confirmation: Confirmation }>("sessions.github.status", { sessionKey: engine.sessionKey, requestId: r.requestId });
            setResult(s.result);
            setConfirmation(s.confirmation);
          }
          if (done(r)) attempt.current = null;
        },
        (e: unknown) => setError(errorText(e)),
      )
      .finally(() => setBusy(false));
  };
  const confirm = () => {
    if (!result || !confirmation) return;
    setBusy(true);
    engine
      .request<Result>("sessions.github.confirm", { sessionKey: engine.sessionKey, requestId: result.requestId, generation: confirmation.generation, account: confirmation.account, requestDigest: confirmation.requestDigest })
      .then(setResult, (e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="pr-box-cd" aria-label="Open a pull request">
      <h3>Open a pull request</h3>
      {result?.status === "published" ? <PullRequestCard result={result} /> : null}
      {result?.status === "failed" ? (
        <p className="err-st" role="alert">
          {result.message} {result.nextAction}
        </p>
      ) : null}
      {result && (result.status === "requested" || result.status === "publishing") ? (
        <p className="hint-st">
          <SIcon name="spin" small className="spin-st" /> {result.message}
        </p>
      ) : null}
      {result?.status === "needs_confirmation" ? (
        <div className="pr-confirm-cd">
          <p className="p0-st">{result.message}</p>
          {confirmation ? (
            <small className="hint-st">
              As {confirmation.account.login} to {confirmation.repository}, {confirmation.branch} into {confirmation.baseBranch}
            </small>
          ) : null}
          <button type="button" className="btn pri sm" disabled={busy || !confirmation} onClick={confirm}>
            Confirm and open it
          </button>
        </div>
      ) : null}
      {!result || done(result) ? (
        <>
          <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={256} placeholder="Title (empty: “Publish” and the branch name)" aria-label="Pull request title" />
          <textarea className="inp pr-body-cd" value={body} onChange={(e) => setBody(e.target.value)} maxLength={8192} placeholder="What changed and why (optional)" aria-label="Pull request description" />
          <div className="acts-br">
            <button type="button" className="btn pri sm" disabled={busy || !selection || !hasChanges} title={!selection ? "Connect a GitHub account in Settings first." : !hasChanges ? "There are no changes to open a pull request for." : undefined} onClick={publish}>
              {busy ? "Opening…" : who ? `Open a pull request as ${who}` : "Open a pull request"}
            </button>
          </div>
        </>
      ) : null}
      {error ? <p className="err-st" role="alert">{error}</p> : null}
    </section>
  );
}
