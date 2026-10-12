// Manage <app> at Advanced and Technical (§4.7.10.1): its commands, its groups, Discord's server actions, its
// health and accounts, and every setting the app has (config.schema.lookup channels.<id>, saved together). A row the
// app has no key for is greyed with why.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Hint, Pick, Pill, Seg, Switch, Val, useLevel, useSaveRunner } from "../kit";
import { ChatLogo as Logo } from "./chatapps-logo";
import { ago, acctLine, acctTone, PILL_WORDS, type Acct } from "./chatapps-data";
import { KeyRow, type Row } from "./chatapps-kit";
import type { ManageProps } from "./chatapps-manage";

type P = ManageProps & { base: string };
const HAS_NO = (name: string) => `${name} has no setting for this.`;
const EVERY: [string, unknown][] = [["As every app", undefined], ["On", true], ["Off", false]];

export function ManageMore(p: P) {
  const level = useLevel();
  const lookup = useResource<RecordValue>(p.engine, "config.schema.lookup", { path: p.base });
  const props = record(record(lookup.data?.schema).properties);
  const children = list(lookup.data?.children);
  const keys = new Set([...children.map((c) => text(c.key)), ...Object.keys(props)]);
  const has = (k: string) => keys.has(k);
  if (level < 1) return null;
  const row = (r: Row, key: string) => has(key) ? r : { ...r, path: undefined, off: HAS_NO(p.app.name) };
  return (
    <div className="mg-ca">
      <h3>Commands</h3>
      <KeyRow cfg={p.cfg} row={row({ t: "Settings commands may save", sub: `Lets /config in ${p.app.name} save changes, when Change settings is on.`, kind: "sw", path: `${p.base}.configWrites`, def: true }, "configWrites")} />
      <KeyRow cfg={p.cfg} row={row({ t: `Commands in ${p.app.name}’s menu`, kind: "seg", path: `${p.base}.commands.native`, opts: EVERY }, "commands")} />
      <KeyRow cfg={p.cfg} row={row({ t: `Skills in ${p.app.name}’s menu`, kind: "seg", path: `${p.base}.commands.nativeSkills`, opts: EVERY }, "commands")} />
      <h3>Groups</h3>
      <Groups {...p} has={has} />
      <h3>How replies arrive</h3>
      <KeyRow cfg={p.cfg} row={{ t: "Long replies", sub: "Paragraph by paragraph, or one message at the end.", kind: "seg", opts: [["As every app", 0], ["In parts", 1], ["All at once", 2]], def: 0, off: "Long replies are set for every app, under How replies arrive." }} />
      {level >= 2 ? <KeyRow cfg={p.cfg} row={{ t: "Wait for more before sending", sub: `For ${p.app.name} only.`, kind: "num", unit: "ms", ph: "1000", off: "Branch has no setting for this per app yet." }} /> : null}
      {p.app.id === "discord" ? <DiscordServer {...p} has={has("actions")} /> : null}
      <h3>Health</h3>
      <Health {...p} />
      {p.app.accounts.length > 1 ? <Accounts {...p} /> : null}
      {level >= 2 ? <AllSettings {...p} fields={fieldsOf(children, props)} loading={lookup.loading} /> : null}
    </div>
  );
}

const GROUP_POL: [string, unknown][] = [["As every app", undefined], ["Groups I approve", "allowlist"], ["Any group", "open"], ["No groups", "disabled"]];
function Groups({ app, cfg, base, has }: P & { has: (k: string) => boolean }) {
  const [gid, setGid] = useState("");
  const own = cfg.get(`${base}.groupPolicy`);
  const eff = text(own ?? cfg.get("channels.defaults.groupPolicy") ?? "allowlist");
  const groups = Object.entries(record(cfg.get(`${base}.groups`))).filter(([id]) => id !== "*");
  const add = () => { const v = gid.trim(); if (v && !v.includes(".")) { void cfg.set(`${base}.groups.${v}`, {}); setGid(""); } };
  return (
    <>
      <KeyRow cfg={cfg} row={{ t: "Groups it answers in", sub: eff === "open" ? "Any group still answers only when mentioned unless a group says otherwise." : "Groups not allowed here get no answer.", kind: "seg", opts: GROUP_POL, ...(has("groupPolicy") ? { path: `${base}.groupPolicy` } : { off: HAS_NO(app.name) }) }} />
      {eff === "allowlist" && has("groups") ? (
        <div className="rows list-ca">
          {groups.map(([id, g]) => {
            const mention = record(g).requireMention !== false;
            return (
              <div key={id} className="prow grp-ca">
                <span className="grow"><b>{visible(id)}</b><small>Answers when {mention ? "mentioned" : "every message"}</small></span>
                <label className="mini-ca">Allowed <Switch checked label={`Allowed in ${id}`} onChange={() => void cfg.set(`${base}.groups.${id}`, null)} /></label>
                <Seg label={`Answers when in ${id}`} value={mention ? "m" : "e"} options={[{ id: "m", label: "Mentioned" }, { id: "e", label: "Every message" }]} onChange={(v) => void cfg.set(`${base}.groups.${id}.requireMention`, v === "m")} />
                <span title="Branch can’t limit who in a group yet."><Pick label={`Who in ${id}`} value="any" disabled options={[{ id: "any", label: "Anyone" }]} onChange={() => undefined} /></span>
              </div>
            );
          })}
          <div className="prow add-ca"><input className="inp" placeholder="Group ID" aria-label="Group ID" value={gid} onChange={(e) => setGid(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /><Btn sm disabled={!gid.trim()} onClick={add}>Add a group by ID</Btn></div>
        </div>
      ) : null}
      {eff === "allowlist" && has("groups") ? <Hint>/activation mention or /activation always in a group changes its “Answers when”. Owners only.</Hint> : null}
      <KeyRow cfg={cfg} row={{ t: "In groups", sub: "Every message it was let in for gets a reply.", kind: "seg", opts: [["Always answer", 0], ["May stay quiet", 1]], def: 0, off: "Branch has no setting for this yet." }} />
    </>
  );
}

const SERVER: [string, string, string, boolean][] = [
  ["channelInfo", "Channel, event and voice info", "Look up channels, events and who is in voice.", true], ["events", "Create events", "", true],
  ["roles", "Change roles", "Off until you choose: it acts on people in your server.", false], ["moderation", "Moderate: time out, kick and ban", "Off until you choose: it acts on people in your server.", false],
  ["presence", "Set its own status", "Off until you choose: it acts on people in your server.", false],
];
function DiscordServer({ cfg, base, has }: P & { has: boolean }) {
  return (
    <>
      <h3>In your server</h3>
      <Hint>What a Trunk can look up and add in your Discord server.</Hint>
      {SERVER.map(([k, t, s, def]) => <KeyRow key={k} cfg={cfg} row={{ t, sub: s || undefined, kind: "sw", def, ...(has ? { path: `${base}.actions.${k}` } : { off: HAS_NO("Discord") }) }} />)}
    </>
  );
}

const MODE_WORDS: Record<string, string> = { polling: "Polling", webhook: "Webhook", socket: "A live connection", websocket: "A live connection" };
function Health({ engine, app, reload, onSetup }: P) {
  const save = useSaveRunner();
  const a: Acct = app.accounts[0] ?? { accountId: "default" };
  const facts: [string, string][] = ([["Started", ago(a.lastStartAt)], ["Last checked", ago(a.lastProbeAt)], ["Last message in", ago(a.lastInboundAt)], ["Receives by", a.mode ? MODE_WORDS[a.mode] ?? visible(a.mode) : ""]] as [string, string][]).filter(([, v]) => v);
  const check = () => void save(async () => { await engine.request("channels.status", { probe: true, channel: app.id }); await reload(); });
  return (
    <>
      {facts.length ? <dl className="kv-ca">{facts.map(([k, v]) => <div key={k} className="contents-ca"><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
      {a.lastError ? <p className="bad-ca">{visible(a.lastError)}</p> : null}
      <div className="acts">
        <Btn sm onClick={check}>Check now</Btn>
        <Btn ghost sm disabled title={`Branch has no help page for ${app.name} yet.`}>Help</Btn>
        <Btn ghost sm onClick={onSetup}>Set up again</Btn>
      </div>
      <Hint>The status pill stays Online or Offline.</Hint>
    </>
  );
}

function Accounts({ app, onSetup }: P) {
  return (
    <>
      <h3>Accounts</h3>
      <div className="rows">
        {app.accounts.map((a) => { const tone = acctTone(a); return (
          <div key={a.accountId} className="prow"><Logo id={app.id} name={app.name} size={28} /><span className="grow"><b>{visible(a.name ?? a.accountId)}</b><small>{acctLine(a, app.name)}</small></span><Pill tone={tone === "ok" ? "ok" : tone === "work" ? "work" : "bad"}>{PILL_WORDS[tone]}</Pill></div>
        ); })}
      </div>
      <Hint>Each account follows “Who answers” unless the routing list gives it its own Trunk.</Hint>
      <div className="acts"><Btn sm onClick={onSetup}>Add another account</Btn></div>
    </>
  );
}

const SECRET = /token|secret|password|key$|apiKey|privateKey|credential/i;
type Field = { key: string; type: string; opts?: string[] };
const SIMPLE = ["boolean", "string", "integer", "number"];
/** The app's simple settings: the lookup's children (with the enum where its schema gives one). */
export function fieldsOf(children: RecordValue[], props: RecordValue): Field[] {
  const src = children.length ? children.filter((c) => c.hasChildren !== true).map((c) => ({ key: text(c.key), type: c.type })) : Object.entries(props).map(([key, v]) => ({ key, type: record(v).type }));
  return src.flatMap(({ key, type }) => {
    const opts = Array.isArray(record(props[key]).enum) ? (record(props[key]).enum as unknown[]).map(String) : undefined;
    const t = opts ? "enum" : (Array.isArray(type) ? type.map(String).find((x) => x !== "null") : text(type)) ?? "";
    return SIMPLE.includes(t) || t === "enum" ? [{ key, type: t, opts }] : [];
  });
}
/** Every simple setting the app has, from its own schema; changes wait for Save, as the preview's form does. */
function AllSettings({ app, cfg, base, fields, loading }: P & { fields: Field[]; loading: boolean }) {
  const [draft, setDraft] = useState<RecordValue>({});
  const [more, setMore] = useState(false);
  const shown = more ? fields : fields.slice(0, 7);
  const val = (k: string) => (k in draft ? draft[k] : cfg.get(`${base}.${k}`));
  const save = async () => { if (await cfg.set(base, draft)) setDraft({}); };
  return (
    <>
      <h3>All settings</h3>
      <Hint>Every setting {app.name} has, from its own list of settings.</Hint>
      {loading ? <Hint>Reading its settings…</Hint> : null}
      <div className="kvform-ca">
        {shown.map((f) => (
          <label key={f.key} className="kvrow-ca"><code>{`${base}.${f.key}`}</code>{SECRET.test(f.key) ? <Val>Edit it in the settings file.</Val> : <FieldInput f={f} value={val(f.key)} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />}</label>
        ))}
      </div>
      {fields.length > 7 ? <button type="button" className="link-k" onClick={() => setMore(!more)}>{more ? "Show less" : "Show more"}</button> : null}
      <div className="acts"><Btn pri sm disabled={!Object.keys(draft).length} onClick={() => void save()}>Save</Btn><Btn ghost sm onClick={() => setDraft({})}>Reload</Btn></div>
    </>
  );
}

function FieldInput({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === "boolean") return <select className="inp" aria-label={f.key} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}><option value="">Not set</option><option value="true">true</option><option value="false">false</option></select>;
  if (f.type === "enum") return <select className="inp" aria-label={f.key} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value || null)}><option value="">Not set</option>{(f.opts ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  const num = f.type === "integer" || f.type === "number";
  return <input className="inp" aria-label={f.key} type={num ? "number" : "text"} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : num ? Number(e.target.value) : e.target.value)} />;
}

