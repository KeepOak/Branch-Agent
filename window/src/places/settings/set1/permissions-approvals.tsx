// Permissions › Locks and records › Approvals (Advanced): what waits now (exec.approval.list, answered with
// exec.approval.resolve), the standing permissions automations hold (exec.approval.grants.list / .revoke) and every
// answered request the engine keeps (approval.history, newest first, a page at a time).
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { errorText, list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Pill, Prow, useLevel, useSaveRunner } from "../kit";

const when = (ms: unknown) => (typeof ms === "number" ? new Date(ms).toLocaleString() : "");
const itemsOf = (v: unknown): RecordValue[] => (Array.isArray(v) ? list(v) : list(record(v).items ?? record(v).approvals));

export function ApprovalsDialog({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const tech = useLevel() >= 2;
  return (
    <Dialog title="Approvals" wide onClose={onClose} testid="approvals">
      <p className="hint">Commands, plugins and Branch, newest first.</p>
      <div className="pm-apr">
        <h3>Waiting now</h3><Waiting engine={engine} tech={tech} />
        <h3>Standing permissions</h3><Standing engine={engine} />
        <h3>Answered</h3><Answered engine={engine} />
        {tech ? <><h3>In the terminal</h3><Terminal /></> : null}
      </div>
    </Dialog>
  );
}

const DECIDE: [string, string, boolean?][] = [["deny", "Don’t"], ["allow-once", "Allow"], ["allow-always", "Always allow", true]];
function Waiting({ engine, tech }: { engine: WindowEngine; tech: boolean }) {
  const exec = useResource<unknown>(engine, "exec.approval.list", {});
  const plugin = useResource<unknown>(engine, "plugin.approval.list", {});
  const save = useSaveRunner();
  const [days, setDays] = useState("");
  if (exec.loading || plugin.loading) return <p className="hint">Reading…</p>;
  if (exec.error) return <p className="hint">{visible(exec.error)}</p>;
  const items = [...itemsOf(exec.data).map((a) => ({ a, plugin: false })), ...itemsOf(plugin.data).map((a) => ({ a, plugin: true }))];
  if (!items.length) return <p className="hint">Nothing is waiting.</p>;
  const answer = (id: string, decision: string, isPlugin: boolean) => void save(async () => {
    const n = Number(days);
    const expiry = !isPlugin && decision === "allow-always" && Number.isInteger(n) && n > 0 ? { grantExpiresInDays: n } : {};
    await engine.request(isPlugin ? "plugin.approval.resolve" : "exec.approval.resolve", { id, decision, ...expiry });
    await Promise.all([exec.reload(), plugin.reload()]);
  });
  return <div className="rows">{items.map(({ a, plugin: p }) => <WaitingRow key={text(a.id)} a={a} tech={tech && !p} days={days} setDays={setDays} onAnswer={(d) => answer(text(a.id), d, p)} />)}</div>;
}

function WaitingRow({ a, tech, days, setDays, onAnswer }: { a: RecordValue; tech: boolean; days: string; setDays: (v: string) => void; onAnswer: (d: string) => void }) {
  const r = record(a.request);
  const allowed = Array.isArray(r.allowedDecisions) ? r.allowedDecisions : DECIDE.map((d) => d[0]);
  return (
    <Prow title={visible(r.command ?? r.title ?? a.id)} sub={[r.agentId ? visible(r.agentId) : "", `asked ${when(a.createdAtMs)}`].filter(Boolean).join(" · ")}>
      {DECIDE.filter(([d]) => allowed.includes(d)).map(([d, label, pri]) => <Btn key={d} sm pri={pri} ghost={d === "deny"} onClick={() => onAnswer(d)}>{label}</Btn>)}
      {tech ? <label className="pm-mini">Ends after <input className="inp" inputMode="numeric" placeholder="until revoked" aria-label="Ends after, days" value={days} onChange={(e) => setDays(e.target.value)} /> days</label> : null}
    </Prow>
  );
}

function Standing({ engine }: { engine: WindowEngine }) {
  const res = useResource<RecordValue>(engine, "exec.approval.grants.list", { limit: 200 });
  const save = useSaveRunner();
  const grants = list(res.data?.grants);
  const revoke = (id: string) => void save(async () => {
    const out = record(await engine.request("exec.approval.grants.revoke", { grantId: id }));
    if (out.outcome === "not-found") throw new Error("That permission is gone already.");
    await res.reload();
  });
  const state = (g: RecordValue) => g.revokedAtMs ? `Revoked ${when(g.revokedAtMs)}` : g.expiresAtMs ? `Ends ${when(g.expiresAtMs)}` : "Until you revoke it";
  return (
    <>
      <p className="hint">Always allow on an automation’s request makes a standing permission for that exact command. Revoke it and the next run asks again. Editing or deleting the automation ends its permissions.</p>
      {res.loading ? <p className="hint">Reading…</p> : res.error ? <p className="hint">{visible(res.error)}</p> : grants.length ? (
        <div className="rows">
          {grants.map((g) => (
            <Prow key={text(g.grantId)} title={visible(g.cronJobName ?? g.cronJobId)} sub={<><code>{visible(g.command)}</code> · {text(g.useCount)} {g.useCount === 1 ? "use" : "uses"} · {state(g)}</>}>
              {g.revokedAtMs ? null : <Btn sm ghost onClick={() => revoke(text(g.grantId))}>Revoke</Btn>}
            </Prow>
          ))}
        </div>
      ) : <p className="hint">No standing permissions. Answer an automation’s request with Always allow to make one.</p>}
    </>
  );
}

const ANSWER: Record<string, ["ok" | "bad" | "idle", string]> = { "allow-once": ["ok", "Allowed once"], "allow-always": ["ok", "Always allowed"], deny: ["bad", "Not allowed"] };
function answerOf(a: RecordValue): ["ok" | "bad" | "idle", string] {
  if (a.status === "expired") return ["idle", "Expired"];
  if (a.status === "cancelled") return ["idle", "Cancelled"];
  return ANSWER[text(a.decision)] ?? ["idle", visible(a.status)];
}
const KIND: Record<string, string> = { exec: "Command", plugin: "Plugin", "system-agent": "Branch" };

function Answered({ engine }: { engine: WindowEngine }) {
  const first = useResource<RecordValue>(engine, "approval.history", { limit: 50 });
  const [more, setMore] = useState<{ items: RecordValue[]; cursor?: string; error?: string }>({ items: [] });
  if (first.loading) return <p className="hint">Reading…</p>;
  if (first.error) return <p className="hint">{visible(first.error)}</p>;
  const items = [...list(first.data?.items), ...more.items];
  const cursor = more.items.length ? more.cursor : typeof first.data?.nextCursor === "string" ? first.data.nextCursor : undefined;
  const load = async () => {
    try {
      const page = record(await engine.request("approval.history", { limit: 50, cursor }));
      setMore({ items: [...more.items, ...list(page.items)], cursor: typeof page.nextCursor === "string" ? page.nextCursor : undefined });
    } catch (e) { setMore({ ...more, error: errorText(e) }); }
  };
  if (!items.length) return <p className="hint">No answered approvals in the last 30 days.</p>;
  return (
    <>
      <div className="rows">{items.map((a) => { const p = record(a.presentation); const [tone, word] = answerOf(a); return (
        <Prow key={text(a.id)} title={visible(p.commandText ?? p.title ?? a.id)} sub={[when(a.resolvedAtMs), KIND[text(p.kind)] ?? visible(p.kind), record(a.source).agentId ? visible(record(a.source).agentId) : ""].filter(Boolean).join(" · ")}><Pill tone={tone}>{word}</Pill></Prow>
      ); })}</div>
      {cursor ? <Btn sm ghost onClick={() => void load()}>Load more</Btn> : null}
      {more.error ? <p className="hint">{visible(more.error)}</p> : null}
      <p className="hint">Answers are kept for 30 days.</p>
    </>
  );
}

const CLI: [string, string, string?][] = [
  ["Waiting", "branch approvals pending"],
  ["Answer one", "branch approvals resolve <id> allow-once", "Or allow-always (with --expires-in-days <n>) or deny."],
  ["Standing permissions", "branch approvals grants list", "200 by default."],
  ["Revoke one", "branch approvals grants revoke <id>"],
];
function Terminal() {
  return <div className="rows">{CLI.map(([t, c, s]) => <Prow key={t} title={t} sub={<><code>{c}</code>{s ? <><br />{s}</> : null}</>} />)}</div>;
}
