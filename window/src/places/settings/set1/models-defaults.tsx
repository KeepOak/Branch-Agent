// Settings › Models › Defaults (§4.7.6): each connection's default model and thinking, which connection answers
// what, and the fallback lists; plus the Defaults-only Advanced and Technical sections. Saves at once.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { shownWhy } from "../../../shell/shown-why";
import { record, text, visible } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Empty, Hint, LinkBtn, Pick, Sec, Seg, Switch, useSaveRunner, type Opt } from "../kit";
import { openPlace } from "../set2/common";
import { Logo } from "./service";
import { connectionsOf, fallbacksOf, modelOpts, refOf, type Connection, type ModelsCtx } from "./models-data";

const PREF = "branch.models.connectionDefaults";
const NONE = "Branch has no setting for this yet.";

/** Each connection's default model, kept with the person's preferences (users.prefs). */
function useConnectionDefaults(m: ModelsCtx) {
  const prefs = useResource<Record<string, unknown>>(m.engine, "users.prefs.get", { keys: [PREF] });
  const save = useSaveRunner();
  const map = record(record(prefs.data?.entries)[PREF]) as Record<string, string>;
  const primary = refOf(m.ownOrShared("model"));
  const pick = (c: Connection) => map[c.id] && c.models.some((x) => x.ref === map[c.id]) ? map[c.id] : c.models.find((x) => x.ref === primary)?.ref ?? c.models[0]?.ref ?? "";
  const set = (c: Connection, ref: string) => save(async () => {
    await m.engine.request("users.prefs.set", { entries: { [PREF]: { ...map, [c.id]: ref } } });
    if (c.models.some((x) => x.ref === primary)) await m.cfg.set(m.own("model", "primary"), ref);
    await prefs.reload();
  });
  return { pick, set };
}

export function DefaultsTab({ m }: { m: ModelsCtx }) {
  const conns = connectionsOf(m.models, m.providers);
  const defs = useConnectionDefaults(m);
  if (!conns.length) return <Empty>No model set up. Add an account so your Trunks have a model to answer with.</Empty>;
  return (
    <>
      <Sec title="Each connection’s default">
        {conns.map((c) => <ConnectionRow key={c.id} m={m} c={c} value={defs.pick(c)} onModel={(ref) => void defs.set(c, ref)} />)}
      </Sec>
      <WhoAnswers m={m} conns={conns} defaultOf={defs.pick} />
      <AnyModelMore />
    </>
  );
}

function ConnectionRow({ m, c, value, onModel }: { m: ModelsCtx; c: Connection; value: string; onModel: (ref: string) => void }) {
  const model = c.models.find((x) => x.ref === value);
  const think = model ? text(m.cfg.get(m.own("models", model.ref, "params", "thinking")) ?? model.thinkingDefault ?? "") : "";
  return (
    <Ctl id={c.name} title={c.name} icon={<Logo id={c.local ? "local" : c.id} name={c.name} size={22} />} sub={c.local ? "On this computer · free and private" : `${c.accounts} ${c.accounts === 1 ? "account" : "accounts"}`}>
      <Pick label={`${c.name} default model`} value={value} options={modelOpts(c.models)} onChange={onModel} />
      {model && model.thinking.length ? <Seg label={`${c.name} thinking`} value={think} options={model.thinking} onChange={(v) => void m.cfg.set(m.own("models", model.ref, "params", "thinking"), v)} /> : null}
    </Ctl>
  );
}

function WhoAnswers({ m, conns, defaultOf }: { m: ModelsCtx; conns: Connection[]; defaultOf: (c: Connection) => string }) {
  const primary = refOf(m.ownOrShared("model"));
  const connOf = (ref: string) => conns.find((c) => c.models.some((x) => x.ref === ref))?.id ?? "";
  const segs: Opt[] = [...conns.filter((c) => c.local), ...conns.filter((c) => !c.local)].map((c) => ({ id: c.id, label: c.name }));
  const setConn = (keys: string[], id: string) => { const c = conns.find((x) => x.id === id); if (c) void m.cfg.set(m.own(...keys), defaultOf(c)); };
  const fallbacks = fallbacksOf(m.ownOrShared("model"));
  const image = refOf(m.cfg.get(m.shared("imageModel")));
  const others = modelOpts(m.models, (x) => x.ref !== primary);
  return (
    <Sec title="">
      <Ctl title="Reading pictures" sub="Used when the conversation’s model can’t see pictures." help="Used when the conversation’s model can’t see pictures. Automatic picks the first connected one that can.">
        <Pick label="Reading pictures" value={image} options={[{ id: "", label: "Automatic" }, ...modelOpts(m.models, (x) => x.images)]} onChange={(v) => void m.cfg.set(m.shared("imageModel", "primary"), v || null)} />
      </Ctl>
      <Ctl title="Everyday answers" sub="Most conversations."><Seg label="Everyday answers" value={connOf(primary)} options={segs} onChange={(id) => setConn(["model", "primary"], id)} /></Ctl>
      <Ctl title="Planning and hard problems" sub="When a task has many steps." off={NONE}><Seg label="Planning and hard problems" value={connOf(primary)} options={segs} onChange={() => undefined} /></Ctl>
      <Ctl title="Quick and cheap jobs" sub="Sorting, tagging, short replies."><Seg label="Quick and cheap jobs" value={connOf(refOf(m.ownOrShared("utilityModel")))} options={segs} onChange={(id) => setConn(["utilityModel"], id)} /></Ctl>
      <Ctl title="Summaries" sub="Keeping long conversations short."><Seg label="Summaries" value={connOf(text(m.cfg.get(m.shared("compaction", "model")) ?? ""))} options={segs} onChange={(id) => { const c = conns.find((x) => x.id === id); if (c) void m.cfg.set(m.shared("compaction", "model"), defaultOf(c)); }} /></Ctl>
      <Ctl title="If the model fails" sub="When the default model can’t answer, try this one." help="When the default model can’t answer, try this one. Your next account is tried first." after={<TrunkFallbackNote m={m} />}>
        <Pick label="If the model fails" value={fallbacks[0] ?? ""} options={[{ id: "", label: "Don’t switch" }, ...others]} onChange={(v) => void m.cfg.set(m.own("model", "fallbacks"), v ? [v, ...fallbacks.filter((f) => f !== v)] : fallbacks.slice(1))} />
      </Ctl>
    </Sec>
  );
}

export function AnyModelMore() {
  return (
    <Sec title="Any model, more" group="Any model">
      <Ctl title="Add pictures and tools to any model" sub="Branch helps models that cannot see pictures or use tools." help="A model that can’t see pictures or call tools gets them through Branch." off={NONE}><Switch checked={false} label="Add pictures and tools to any model" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

const PATTERNS = [
  ["one", "One at a time", "A Trunk calls a specialist, waits, carries on."], ["super", "A lead and helpers", "One Trunk plans and hands out the parts."],
  ["swarm", "Swarm", "Equals pass the work to whoever fits best."], ["router", "Router", "Sends each request to the one Trunk that matches."],
  ["parallel", "In parallel", "The same job split up, then gathered."], ["teams", "Teams", "Small groups, each with its own lead."],
];
export function HowTrunksWork() {
  return (
    <Sec title="How Trunks work together, by default" hint="For groups and big jobs." help="For groups and big jobs. A Trunk may suggest another pattern for one job; yours wins unless you agree. A group can use its own Group rules.">
      <div className="pats-k" role="radiogroup" aria-label="How Trunks work together" title={shownWhy(NONE)}>
        {PATTERNS.map(([id, name, sub]) => <button key={id} type="button" role="radio" aria-checked={id === "super"} className="pat-k" disabled><b>{name}</b><small>{sub}</small></button>)}
      </div>
      {shownWhy(NONE) ? <p className="hint">{shownWhy(NONE)}</p> : null}
      <Ctl title="A Trunk may suggest a different pattern" sub="It asks first; nothing changes until you agree." off={NONE}><Switch checked label="A Trunk may suggest a different pattern" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

const FAST: Opt[] = [{ id: "own", label: "Model’s own" }, { id: "auto", label: "Auto" }, { id: "on", label: "On" }, { id: "off", label: "Off" }];
export function NewConversations({ m }: { m: ModelsCtx }) {
  const v = m.ownOrShared("fastModeDefault");
  const value = v === "auto" ? "auto" : v === true ? "on" : v === false ? "off" : "own";
  const write = (id: string) => void m.cfg.set(m.own("fastModeDefault"), id === "auto" ? "auto" : id === "on" ? true : id === "off" ? false : null);
  return (
    <Sec title="New conversations">
      <Ctl title="Start where you left off" sub="The computer and project folder you picked last time for that Trunk." off={NONE}><Switch checked label="Start where you left off" onChange={() => undefined} /></Ctl>
      <Ctl title="Fast replies" sub="Fast lanes can cost more. Model’s own never turns one on by itself."><Seg label="Fast replies" value={value} options={FAST} onChange={write} /></Ctl>
    </Sec>
  );
}

/** Trunks with their own model do not inherit the household's answer fallbacks. */
function TrunkFallbackNote({ m }: { m: ModelsCtx }) {
  if (m.scope) return null;
  const trunks = Object.entries(record(m.cfg.get(["agents", "entries"])))
    .filter(([, entry]) => refOf(record(entry).model).trim());
  if (!trunks.length) return null;
  return (
    <div>
      <Hint>These Trunks have their own model and do not use this setting for answers. Open a Trunk’s settings, choose Advanced detail, then What it may do › Add a stand-in… to set its own stand-ins.</Hint>
      <ul aria-label="Trunks with their own model">
        {trunks.map(([id, entry]) => (
          <li key={id}><LinkBtn onClick={() => {
            openPlace("people");
            window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId: id, view: "edit" } }));
          }}>{visible(record(record(entry).identity).name || record(entry).name || id)}</LinkBtn></li>
        ))}
      </ul>
    </div>
  );
}

/** If the model fails: the ordered fallback lists for answers and for reading pictures. */
export function FallbackLists({ m }: { m: ModelsCtx }) {
  return (
    <Sec title="If the model fails" hint="Tries fallback models in order when the first fails." help="Tried in order when the model a conversation uses fails: sign-in trouble, limits or time-outs. Your other accounts with the same service are tried first (Accounts).">
      <TrunkFallbackNote m={m} />
      <FallbackList m={m} title="For answers" keys={["model"]} own />
      <FallbackList m={m} title="For reading pictures" keys={["imageModel"]} images />
    </Sec>
  );
}

function FallbackList({ m, title, keys, own, images }: { m: ModelsCtx; title: string; keys: string[]; own?: boolean; images?: boolean }) {
  const path = (own ? m.own : m.shared)(...keys, "fallbacks");
  const value = own ? m.ownOrShared(...keys) : m.cfg.get(m.shared(...keys));
  const items = fallbacksOf(value);
  const name = (ref: string) => m.models.find((x) => x.ref === ref)?.name ?? visible(ref);
  const put = (next: string[]) => void m.cfg.set(path, next);
  const addable = modelOpts(m.models, (x) => !items.includes(x.ref) && x.ref !== refOf(value) && (!images || x.images));
  return (
    <div className="fbl-k">
      <h3>{title}</h3>
      {items.length ? (
        <div className="rows">
          {items.map((ref, i) => (
            <div key={ref} className="prow"><span className="grow"><b>{i + 1}. {name(ref)}</b></span>
              <Btn sm ghost disabled={i === 0} onClick={() => put([...items.slice(0, i - 1), ref, items[i - 1], ...items.slice(i + 1)])}>Move up</Btn>
              <Btn sm ghost onClick={() => put(items.filter((x) => x !== ref))}>Remove</Btn>
            </div>
          ))}
        </div>
      ) : <Hint>Nothing to try next. When the model fails, the conversation stops and says why.</Hint>}
      <div className="acts">
        <Pick label={`Add a model to ${title.toLowerCase()}`} value="" options={[{ id: "", label: "Add a model" }, ...addable]} onChange={(v) => v && put([...items, v])} />
        {items.length ? <Btn sm ghost onClick={() => put([])}>Clear</Btn> : null}
      </div>
    </div>
  );
}

/** Model nicknames (Technical): agents.defaults.models.<ref>.alias, usable anywhere a model is picked. */
export function Nicknames({ m }: { m: ModelsCtx }) {
  const [nick, setNick] = useState("");
  const [ref, setRef] = useState("");
  const map = record(m.cfg.get(m.own("models")));
  const named = Object.entries(map).filter(([, v]) => typeof record(v).alias === "string");
  const target = ref || m.models[0]?.ref || "";
  return (
    <Sec title="Model nicknames">
      <Hint>Use a nickname anywhere a model is picked, like /model opus.</Hint>
      {named.length ? named.map(([r, v]) => (
        <Ctl key={r} id={`nick-${r}`} title={text(record(v).alias)} sub={m.models.find((x) => x.ref === r)?.name ?? visible(r)}><Btn sm ghost onClick={() => void m.cfg.set(m.own("models", r, "alias"), null)}>Remove</Btn></Ctl>
      )) : <Hint>No nicknames yet.</Hint>}
      <Ctl title="Add a nickname">
        <input className="inp" placeholder="Nickname" aria-label="Nickname" value={nick} onChange={(e) => setNick(e.target.value)} />
        <Pick label="Model for the nickname" value={target} options={modelOpts(m.models)} onChange={setRef} />
        <Btn sm disabled={!nick.trim() || !target} onClick={() => { void m.cfg.set(m.own("models", target, "alias"), nick.trim()); setNick(""); }}>Add</Btn>
      </Ctl>
    </Sec>
  );
}
