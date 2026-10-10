// Settings › Chat apps › Manage <app> (§4.7.10.1): who answers there, who may message it (channels.<id>.dmPolicy and
// allowFrom), who is asking, its live state with Pause/Start (channels.stop/start, kept with channels.<id>.enabled),
// its token (the engine's setup steps again) and Disconnect. Advanced and Technical parts are in chatapps-manage-more.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { record, text, visible } from "../adapter";
import { Btn, Ctl, Hint, LinkBtn, Pick, Pill, Seg, Switch, Val, useSaveRunner } from "../kit";
import { ChatLogo as Logo } from "./chatapps-logo";
import type { App, Trunk } from "./chatapps-data";
import type { Cfg } from "./chatapps-kit";
import type { Pairing } from "./chatapps-asking";
import { WhoSeg } from "./chatapps-who";
import { ManageMore } from "./chatapps-manage-more";
import { NATIVE } from "./chatapps-parts";

export type ManageProps = {
  engine: WindowEngine; app: App; cfg: Cfg; trunks: Trunk[]; defaultId: string; pairing?: Pairing;
  reload: () => Promise<void>; onReview: (channel: string, accountId: string) => void; onPerChat: () => void; onSetup: () => void; onClose: () => void;
};

const WHO: { id: string; label: string; policy?: string; off?: string }[] = [
  { id: "me", label: "Only me", policy: "allowlist" }, { id: "pairing", label: "People I approve", policy: "pairing" },
  { id: "workspace", label: "Anyone in my workspace", off: "Branch can’t tell who is in your workspace yet." },
  { id: "open", label: "Anyone", policy: "open" }, { id: "disabled", label: "No one", policy: "disabled" },
];
const GROUP = "accessGroup:";

export function ManageDialog(p: ManageProps) {
  const base = `channels.${p.app.id}`;
  const policy = text(p.cfg.get(`${base}.dmPolicy`) ?? "pairing");
  const rawAllow = p.cfg.get(`${base}.allowFrom`);
  const allow = Array.isArray(rawAllow) ? rawAllow.map(String) : [];
  const setWho = (id: string) => {
    const w = WHO.find((x) => x.id === id);
    if (!w?.policy) return;
    const withStar = w.policy === "open" && !allow.includes("*") ? [...allow, "*"] : allow;
    void p.cfg.set(base, { dmPolicy: w.policy, ...(withStar !== allow ? { allowFrom: withStar } : {}) });
  };
  return (
    <Dialog title={`Manage ${p.app.name}`} wide onClose={p.onClose} testid="chatapps-manage"
      footer={<button type="button" className="btn ghost" title="The setup steps again: a new token, a new check" onClick={p.onSetup}>Back</button>}>
      <div className="ca-head"><Logo id={p.app.id} name={p.app.name} size={40} /><span className="grow"><b>{p.app.name}</b>{p.app.detail ? <small>{p.app.detail}</small> : null}</span></div>
      {p.app.tone === "ok" ? null : <SetupSteps done={false} />}
      <div className="fld-ca"><span>Who answers in {p.app.name}</span><WhoSeg app={p.app} cfg={p.cfg} trunks={p.trunks} defaultId={p.defaultId} /><LinkBtn onClick={p.onPerChat}>Choose per chat</LinkBtn></div>
      <Ctl title="Who may message it" sub="Everyone else gets no answer.">
        <Seg layout="radio" label="Who may message it" value={WHO.find((w) => w.policy === policy)?.id ?? ""} options={WHO.map((w) => ({ id: w.id, label: w.label, off: w.id === "me" && !allow.filter((a) => a !== "*").length ? "Add yourself below first." : w.off }))} disabled={p.cfg.loading} onChange={setWho} />
      </Ctl>
      {policy === "pairing" || policy === "allowlist" ? <Approved {...p} base={base} allow={allow} /> : null}
      {policy === "pairing" ? <AskingHere {...p} /> : null}
      {p.app.id === "telegram" ? <>
        <Ctl title="Keep forum topics apart" sub="Each topic in a group becomes its own conversation." off="Branch has no setting for this yet."><Switch checked label="Keep forum topics apart" disabled onChange={() => undefined} /></Ctl>
        <Ctl title="Photos and files reach the task" sub={`What you send in ${p.app.name} is handed to the Trunk as material.`} off="Branch has no setting for this yet."><Switch checked label="Photos and files reach the task" disabled onChange={() => undefined} /></Ctl>
      </> : null}
      <Running {...p} base={base} />
      <ManageMore {...p} base={base} />
      <Disconnect {...p} base={base} />
    </Dialog>
  );
}

/** The people let in (allowFrom), one per row, and a list of people to use instead. */
function Approved({ app, cfg, base, allow }: ManageProps & { base: string; allow: string[] }) {
  const held = [...new Set(app.accounts.flatMap((a) => (Array.isArray(a.allowFrom) ? a.allowFrom.map(String) : [])))].filter((x) => x !== "*" && !allow.includes(x));
  const [add, setAdd] = useState("");
  const people = allow.filter((a) => a !== "*" && !a.startsWith(GROUP));
  const group = allow.find((a) => a.startsWith(GROUP))?.slice(GROUP.length) ?? "";
  const lists = Object.keys(record(cfg.get("accessGroups")));
  const put = (next: string[]) => void cfg.set(`${base}.allowFrom`, next.length ? next : null);
  const plus = () => { const v = add.trim(); if (v && !allow.includes(v)) { put([...allow, v]); setAdd(""); } };
  return (
    <>
      <div className="rows list-ca">
        {people.map((who) => <div key={who} className="prow"><span className="grow"><b>{visible(who)}</b><small>Allowed to message it</small></span><Btn ghost sm onClick={() => put(allow.filter((a) => a !== who))}>Remove</Btn></div>)}
        {held.map((who) => <div key={`held:${who}`} className="prow"><span className="grow"><b>{visible(who)}</b><small>Allowed to message it</small></span><span title="Branch can’t remove someone the engine let in yet."><Btn ghost sm disabled>Remove</Btn></span></div>)}
        {!people.length && !held.length ? <Hint>No one yet.</Hint> : null}
        <Hint>People you approve from a request are kept by the engine and may not be listed here yet.</Hint>
        <div className="prow add-ca"><input className="inp" placeholder={`Their ${app.name} ID or @name`} aria-label={`Their ${app.name} ID or @name`} value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && plus()} /><Btn sm disabled={!add.trim()} onClick={plus}>Add</Btn></div>
      </div>
      <Ctl title="Use a list" sub="Everyone else gets no answer.">
        <Pick label="Use a list" value={group} disabled={cfg.loading} options={[{ id: "", label: "None" }, ...lists.map((l) => ({ id: l, label: visible(l) }))]}
          onChange={(v) => put([...allow.filter((a) => !a.startsWith(GROUP)), ...(v ? [GROUP + v] : [])])} />
      </Ctl>
    </>
  );
}

/** Who is asking, per account of this app (channels.pairing.list); Review shows them on the page. */
function AskingHere({ app, pairing, onReview }: ManageProps) {
  const accts = (pairing?.accounts ?? []).filter((a) => a.channel === app.id);
  if (!accts.length) return null;
  return (
    <div className="sub-ca">
      <b>Asking to message</b>
      {accts.map((a) => {
        const n = (pairing?.requests ?? []).filter((r) => r.channel === app.id && r.accountId === a.accountId).length;
        return <Ctl key={a.accountId} title={visible(a.accountLabel ?? a.accountId)}>{n ? <Pill tone="warn">{`${n} waiting`}</Pill> : <Pill tone="idle">No one waiting</Pill>}<Btn sm onClick={() => onReview(app.id, a.accountId)}>Review</Btn></Ctl>;
      })}
      <Hint>People must be approved before their direct messages reach the Trunk.</Hint>
    </div>
  );
}

const SOURCE_WORDS: Record<string, string> = { config: "Kept in the settings file", env: "From an environment variable", file: "From a file", none: "Not set", secretRef: "Kept in Saved passwords" };
/** channels.start/stop/logout act on one account; an app with several runs it for each. */
async function eachAccount(engine: ManageProps["engine"], app: App, method: string) {
  const ids = app.accounts.length ? app.accounts.map((a) => a.accountId) : [undefined];
  for (const accountId of ids) await engine.request(method, { channel: app.id, ...(accountId ? { accountId } : {}) });
}
const fromEnv = (app: App) => app.accounts.some((a) => (a.botTokenSource ?? a.tokenSource) === "env");
const isLinked = (app: App) => app.accounts.some((a) => a.linked !== undefined);

/** Its state, Pause/Start, and where its token comes from (or its linked phone, with Unlink). */
function Running({ engine, app, cfg, base, reload, onSetup }: ManageProps & { base: string }) {
  const save = useSaveRunner();
  const main = app.accounts[0];
  const source = main?.botTokenSource ?? main?.tokenSource ?? "";
  const toggle = async () => {
    const start = app.paused || !app.running;
    if (!(await cfg.set(`${base}.enabled`, start ? null : false))) return;
    await save(() => eachAccount(engine, app, start ? "channels.start" : "channels.stop"));
    await reload();
  };
  const state = app.paused ? "paused" : app.running ? "running" : "stopped";
  return (
    <div className="box-ca">
      <div className="box-h-ca"><Pill tone={app.paused ? "idle" : app.tone === "ok" ? "ok" : app.tone === "work" ? "work" : "bad"}>{app.paused ? "Paused" : app.word}</Pill>{!app.paused && app.tone === "bad" ? <small>{app.sub}</small> : null}</div>
      <Ctl title="Connection"><Btn sm disabled={cfg.loading} onClick={() => void toggle()}>{state === "running" ? "Pause" : "Start"}</Btn></Ctl>
      {isLinked(app) ? <Ctl title={app.accounts.some((a) => a.linked === true) ? `Linked to your ${app.name} account` : "Not linked"} sub={`This computer keeps the link to your ${app.name} account.`}><Btn sm disabled={!app.accounts.some((a) => a.linked === true)} onClick={() => void save(async () => { await eachAccount(engine, app, "channels.logout"); await reload(); })}>Unlink</Btn></Ctl> : null}
      {source ? <Ctl title="Token" sub={`Replacing it restarts ${app.name} with the new one.`}><Val>{SOURCE_WORDS[source] ?? visible(source)}</Val><Btn sm onClick={onSetup}>Replace</Btn></Ctl> : null}
      {[["Sees edited messages", "It answers the latest version."], ["Photo albums as one message", "Not one reply per photo."], [`Online status in ${app.name}`, "“Online” or “Offline, back soon” in the bot’s description."]].map(([t, s]) => (
        <Ctl key={t} title={t} sub={s} off="Branch has no setting for this yet."><Switch checked={!t.startsWith("Online")} label={t} disabled onChange={() => undefined} /></Ctl>
      ))}
      <Ctl title="Formatting" off="Each app’s own formatting is always used."><Seg label="Formatting" value="own" options={[{ id: "own", label: NATIVE[app.id] ?? "Its own styles" }, { id: "plain", label: "Plain text" }]} disabled onChange={() => undefined} /></Ctl>
      {app.tone === "bad" && !app.paused ? <div className="acts"><Btn pri sm onClick={onSetup}>Set it up again</Btn></div> : null}
    </div>
  );
}

/** Disconnect: stops it and forgets its settings and token (channels.<id> removed). Conversations stay. */
function Disconnect({ engine, app, cfg, base, reload, onClose }: ManageProps & { base: string }) {
  const save = useSaveRunner();
  const [ask, setAsk] = useState(false);
  const env = fromEnv(app);
  const go = async () => {
    if (!(await save(() => eachAccount(engine, app, isLinked(app) ? "channels.logout" : "channels.stop")))) return;
    if (!(await cfg.set(base, env ? { enabled: false } : null))) return;
    await reload();
    setAsk(false);
    onClose();
  };
  return (
    <div className="danger-ca">
      <div><b>Disconnect {app.name}</b><p>{env ? "Stops it and keeps it off. Its token comes from this computer’s environment, so remove it there too." : "Stops it and forgets its token and settings. Conversations stay in Branch."}</p></div>
      <Btn className="bad" onClick={() => setAsk(true)}>Disconnect</Btn>
      {ask ? <Dialog title={`Disconnect ${app.name}?`} onClose={() => setAsk(false)} testid="chatapps-disconnect" footer={<><button type="button" className="btn ghost" onClick={() => setAsk(false)}>Cancel</button><button type="button" className="btn bad" onClick={() => void go()}>Disconnect</button></>}>
        <p className="dlg-p-ca">{env ? "Branch stops listening there and turns it off. You can connect it again later." : isLinked(app) ? "Branch stops listening there and unlinks this computer. You can connect it again later." : "Branch stops listening there and deletes its saved token. You can connect it again later."}</p>
      </Dialog> : null}
    </div>
  );
}

/** The five setup steps (the preview's .chw-steps12): every one ticked once the app is connected. Changes here save as
 *  they are made, so Save closes; Back goes through the engine's setup steps again. */
function SetupSteps({ done }: { done: boolean }) {
  return (
    <div className="chw-steps12" aria-label="Setup steps">
      {["Create", "Paste", "Check", "Pair", "Save"].map((name, i) => (
        <span key={name} className={done ? "done" : undefined}><em>{done ? "✓" : i + 1}</em>{name}</span>
      ))}
    </div>
  );
}
