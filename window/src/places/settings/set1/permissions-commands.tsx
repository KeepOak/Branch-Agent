// Permissions › Rules for each tool and folder, and Commands, by default (Advanced). Both live in the engine's exec
// approvals file: the rules are the wildcard ("*") allowlist, the defaults are file.defaults, and each Trunk keeps
// its own policy and allowed commands under file.agents.<id>. Another computer's rules come from
// exec.approvals.node.get and are read-only here, the way the preview shows them.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { Icon } from "../../../shell/icons";
import { list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Empty, Hint, Pick, Pill, Plist, Prow, Seg, Switch } from "../kit";
import type { Ctx } from "./permissions-rows";
import { withAgent, withDefault, type AllowEntry, type ApprovalsFile } from "./permissions-file";

export const RUN = [{ id: "deny", label: "None" }, { id: "allowlist", label: "Only listed ones" }, { id: "full", label: "Any" }];
const ASK = [{ id: "off", label: "Never" }, { id: "on-miss", label: "When it isn’t listed" }, { id: "always", label: "Every time" }];
const FALLBACK = [{ id: "deny", label: "Refuse" }, { id: "allowlist", label: "Only listed ones" }, { id: "full", label: "Run it" }];
const UP = <svg className="i s" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const THIS_PC = "this";

export const trunkName = (t: RecordValue): string => visible(record(t.identity).name ?? t.name ?? t.id);
export const nodeName = (n: RecordValue): string => visible(n.displayName ?? n.nodeId);

export function RulesFor({ x }: { x: Ctx }) {
  const opts = [{ id: THIS_PC, label: "This computer (the Gateway)" }, ...x.nodes.map((n) => ({ id: text(n.nodeId), label: nodeName(n) }))];
  return (
    <Ctl title="Rules for" sub={x.nodes.length ? "Each computer that runs commands can keep its own rules." : "No other computer shares its command rules yet."}>
      <Pick label="Rules for" value={x.rulesFor} options={opts} onChange={x.setRulesFor} />
    </Ctl>
  );
}

export function RulesList({ x }: { x: Ctx }) {
  const [adding, setAdding] = useState(false);
  if (x.rulesFor !== THIS_PC) {
    const node = x.nodes.find((n) => text(n.nodeId) === x.rulesFor);
    return node ? <NodeRules engine={x.engine} node={node} /> : null;
  }
  const rules = x.ap.snap?.file.agents?.["*"]?.allowlist ?? [];
  const save = (next: AllowEntry[]) => x.ap.update((f) => withAgent(f, "*", (a) => ({ ...a, allowlist: next.length ? next : undefined })));
  const up = (i: number) => { const next = [...rules]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; void save(next); };
  return (
    <>
      <Hint>The first rule that matches wins. Everything else follows the mode.</Hint>
      {x.ap.loading ? <Hint>Reading the rules…</Hint> : x.ap.error ? <Hint>{visible(x.ap.error)}</Hint> : rules.length ? (
        <Plist>
          {rules.map((r, i) => (
            <Prow key={`${r.pattern}/${i}`} icon={<Pill tone="ok">Allow</Pill>} title={visible(r.pattern)} sub={`${r.argPattern ? `${visible(r.argPattern)} · ` : ""}anywhere · rule ${i + 1}`}>
              <button type="button" className="icon-btn" aria-label="Move up" title={i ? "Move up" : "First already"} disabled={!i} onClick={() => up(i)}>{UP}</button>
              <Btn sm ghost onClick={() => void save(rules.filter((_, j) => j !== i))}>Remove</Btn>
            </Prow>
          ))}
        </Plist>
      ) : <Empty>No rules yet. Everything follows the mode.</Empty>}
      <div className="acts" data-row="Add a rule"><Btn sm disabled={x.ap.loading || Boolean(x.ap.error)} onClick={() => setAdding(true)}><Icon name="plus" small />Add a rule</Btn></div>
      {adding ? <AddRule onClose={() => setAdding(false)} onAdd={(p) => save([...rules, { pattern: p }])} /> : null}
    </>
  );
}

const KINDS = [{ id: "allow", label: "Allow" }, { id: "ask", label: "Ask", off: "Everything not allowed already follows the mode." }, { id: "never", label: "Never", off: "The engine’s rules only allow; “Read only” or “None” refuse." }];
function AddRule({ onClose, onAdd }: { onClose: () => void; onAdd: (pattern: string) => Promise<boolean> }) {
  const [pattern, setPattern] = useState("");
  const add = async () => { if (pattern.trim() && await onAdd(pattern.trim())) onClose(); };
  return (
    <Dialog title="Add a rule" onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn pri" disabled={!pattern.trim()} onClick={() => void add()}>Add</button></>}>
      <label className="fld"><span>A command or program</span><input className="inp" autoFocus placeholder="git status*" aria-label="A command or program" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} /></label>
      <div className="fld"><span>It may</span><Seg label="It may" value="allow" options={KINDS} onChange={() => undefined} /></div>
      <p className="hint">Every Trunk on this computer follows it.</p>
    </Dialog>
  );
}

const ACTION: Record<string, ["ok" | "idle" | "bad", string]> = { allow: ["ok", "Allow"], prompt: ["idle", "Ask"], deny: ["bad", "Never"] };
function NodeRules({ engine, node }: { engine: WindowEngine; node: RecordValue }) {
  const res = useResource<RecordValue>(engine, "exec.approvals.node.get", { nodeId: text(node.nodeId) });
  const name = nodeName(node);
  if (res.loading) return <Hint>Reading {name}’s rules…</Hint>;
  if (res.error) return <Hint>{visible(res.error)}</Hint>;
  const d = res.data ?? {};
  if (d.enabled === false) return <Hint>{visible(d.message ?? `${name} doesn’t share its rules.`)}</Hint>;
  const native = Array.isArray(d.rules);
  const rules = native ? list(d.rules).map((r) => ({ a: text(r.action), t: text(r.pattern), w: r.description ? visible(r.description) : "anywhere" }))
    : list(record(record(record(d.file).agents)["*"]).allowlist).map((r) => ({ a: "allow", t: text(r.pattern), w: "anywhere" }));
  const def = native ? ACTION[text(d.defaultAction)]?.[1] : record(d.resolvedDefaults).ask === "off" ? "Follows the mode" : "Ask";
  return (
    <>
      <Hint>{name} keeps its own rules. Change them in its Branch app or with the branch command. Default: {def ?? "Follows the mode"} · {rules.length} {rules.length === 1 ? "rule" : "rules"}</Hint>
      {rules.length ? <Plist>{rules.map((r, i) => { const [tone, word] = ACTION[r.a] ?? ["idle", visible(r.a)]; return <Prow key={`${r.t}/${i}`} icon={<Pill tone={tone}>{word}</Pill>} title={visible(r.t)} sub={`${r.w} · rule ${i + 1}`} />; })}</Plist> : null}
    </>
  );
}

const labelOf = (opts: { id: string; label: string }[], id: string) => opts.find((o) => o.id === id)?.label ?? visible(id);

/** Commands, by default: the file's defaults, then each Trunk's own policy and allowed commands. */
export function CommandDefaults({ x }: { x: Ctx }) {
  const { ap } = x;
  if (x.rulesFor !== THIS_PC) {
    const node = x.nodes.find((n) => text(n.nodeId) === x.rulesFor);
    return <Hint>{node ? nodeName(node) : "That computer"} keeps its own command defaults; change them there.</Hint>;
  }
  const r = ap.resolved;
  const set = (key: "security" | "ask" | "askFallback" | "autoAllowSkills") => (v: string | boolean) => void ap.update((f) => withDefault(f, key, v));
  const busy = ap.loading || Boolean(ap.error);
  return (
    <>
      <Hint>Follows “Mode everywhere” unless you set it here.</Hint>
      <Ctl title="Commands may run"><Seg label="Commands may run" value={r.security} options={RUN} disabled={busy} onChange={set("security")} /></Ctl>
      <Ctl title="Ask before a command" sub="The engine’s own default, as “Mode everywhere” ships Full access."><Seg label="Ask before a command" value={r.ask} options={ASK} disabled={busy} onChange={set("ask")} /></Ctl>
      <Ctl title="When nobody can be asked" sub="When no window, phone or chat app can show the request."><Seg label="When nobody can be asked" value={r.askFallback} options={FALLBACK} disabled={busy} onChange={set("askFallback")} /></Ctl>
      <Ctl title="Let skill programs run" sub="Programs your installed skills list as their own run without a rule. Off until you choose: they would run without asking."><Switch label="Let skill programs run" checked={r.autoAllowSkills} disabled={busy} onChange={set("autoAllowSkills")} /></Ctl>
      {x.trunks.map((t) => <TrunkCommands key={text(t.id)} x={x} trunk={t} defLabel={labelOf(RUN, r.security)} />)}
    </>
  );
}

function TrunkCommands({ x, trunk, defLabel }: { x: Ctx; trunk: RecordValue; defLabel: string }) {
  const [open, setOpen] = useState(false);
  const id = text(trunk.id);
  const own = x.ap.snap?.file.agents?.[id] ?? {};
  const pats = own.allowlist ?? [];
  const name = trunkName(trunk);
  const pick = (v: string) => void x.ap.update((f) => withAgent(f, id, (a) => { const n = { ...a }; if (v) n.security = v; else delete n.security; return n; }));
  return (
    <Ctl title={name} id={name} sub={pats.length ? pats.map((p) => visible(p.pattern)).join(", ") : "No allowed commands of its own."}>
      <Pick label={`${name}: commands may run`} value={own.security ?? ""} options={[{ id: "", label: `Use the default (${defLabel})` }, ...RUN]} disabled={x.ap.loading} onChange={pick} />
      <Btn sm ghost onClick={() => setOpen(true)}>{pats.length ? `${pats.length} allowed` : "Allowed commands"}</Btn>
      {open ? <Patterns ap={x.ap} id={id} name={name} onClose={() => setOpen(false)} /> : null}
    </Ctl>
  );
}

function Patterns({ ap, id, name, onClose }: { ap: ApprovalsFile; id: string; name: string; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const pats = ap.snap?.file.agents?.[id]?.allowlist ?? [];
  const save = (next: AllowEntry[]) => ap.update((f) => withAgent(f, id, (a) => ({ ...a, allowlist: next.length ? next : undefined })));
  const add = async () => { if (draft.trim() && await save([...pats, { pattern: draft.trim() }])) setDraft(""); };
  const last = (p: AllowEntry) => (p.lastUsedAt ? `Last used ${new Date(p.lastUsedAt).toLocaleString()}` : "Not used yet");
  return (
    <Dialog title={`Allowed commands for ${name}`} onClose={onClose} footer={<button type="button" className="btn pri" onClick={onClose}>Done</button>}>
      {pats.length ? <div className="rows">{pats.map((p, i) => <Prow key={`${p.pattern}/${i}`} title={<code>{visible(p.pattern)}</code>} sub={last(p)}><Btn sm ghost onClick={() => void save(pats.filter((_, j) => j !== i))}>Remove</Btn></Prow>)}</div> : <p className="hint">None yet.</p>}
      <div className="prow pm-add"><input className="inp" placeholder="git status*" aria-label="A pattern" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} /><Btn sm disabled={!draft.trim()} onClick={() => void add()}>Add a pattern</Btn></div>
    </Dialog>
  );
}
