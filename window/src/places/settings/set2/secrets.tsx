// Settings › Saved passwords (DESIGN-SPEC §4.7.13): the password manager (secrets.providers + its plugin), the keys
// Branch holds (secrets.store.list / set / delete), key sources, plain-text findings from the settings and
// secrets.reload. Filling website sign-ins from a password manager needs an engine fill list, so that list says why.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Empty, Hint, Page, Pill, Plist, Prow, Sec, Seg, Status, useConfig, type RowEntry } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { Menu, type MenuItem } from "../../../shell/Menu";
import { Icon } from "../../../shell/icons";
import { CallLine, CodeRow, lvOf, rec, str, Tile, useCall, useLive, when, type RecordValue } from "./common";
import { Ico } from "./icons";

const LEDE = "Sign-ins Branch may fill for you. It never sees or stores the passwords.";
const ONEPASSWORD = { source: "exec", pluginIntegration: { pluginId: "onepassword", integrationId: "onepassword" } };
const REDACTED = "__BRANCH_REDACTED__";
const KEYLIKE = /(_API_KEY|_TOKEN|_PASSWORD|_PRIVATE_KEY|_SECRET)$/;
const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export const ROWS: RowEntry[] = [
  ["Make narrow keys for services", "Narrow keys", 0], ["Password manager", "Where passwords come from", 1],
  ["Keys kept apart from settings", "Where passwords come from", 1], ["Sign-in tokens", "Where passwords come from", 1],
  ["List the keys", "Keys Branch holds", 2], ["Set a key", "Keys Branch holds", 2], ["Remove a key", "Keys Branch holds", 2],
  ["Bring in a .env file", "Keys Branch holds", 2], ["Reload keys", "Keys, technical", 2], ["Keys written in plain text", "Keys, technical", 2],
  ["Move keys out of settings", "Keys, technical", 2], ["The settings file", "Keys, technical", 2],
].map(([title, sec, lv]) => ({ page: "secrets", title: String(title), sec: String(sec), group: ({ "Where passwords come from": "Keys", "Keys Branch holds": "Keys", "Keys, technical": "Keys" } as Record<string, string>)[String(sec)] ?? String(sec), lv: lv as 0 | 1 | 2 }));

export function SecretsPage(props: SettingsPageProps) {
  const lv = lvOf(props.level);
  const config = useConfig(props.engine);
  const store = useLive<RecordValue>(props.engine, "secrets.store.list", {}, ["secrets"]);
  const onePassword = rec(rec(config.get("secrets.providers")).onepassword).source === "exec";
  return (
    <Page title={props.title} lede={LEDE}>
      {onePassword
        ? <Status title="1Password is set up">Branch asks 1Password for a key when a setting points to it.</Status>
        : <Status tone="bad" title="No password manager is connected">Turns on when a password manager is connected.</Status>}
      <Sec title="Branch may fill">
        <Empty>{onePassword ? "Filling website sign-ins needs the engine’s list of sign-ins Branch may fill." : "Nothing to fill until a password manager is connected. Pick one at Advanced: How much to show › Advanced, then “Where passwords come from”."}</Empty>
      </Sec>
      <Sec title="Narrow keys">
        <Ctl title="Make narrow keys for services" sub="Creates limited keys for services such as Vercel." help="Vercel, Supabase and others: a key that can do only what a Trunk needs, replaced on a schedule." off="Needs the engine to make keys with each service."><Btn sm disabled>Choose a service</Btn></Ctl>
      </Sec>
      {lv >= 1 ? <Where engine={props.engine} onePassword={onePassword} config={config} /> : null}
      {lv >= 1 ? <Keys engine={props.engine} lv={lv} store={store} /> : null}
      {lv >= 2 ? <KeysTechnical engine={props.engine} store={store} config={config} /> : null}
    </Page>
  );
}

type Config = ReturnType<typeof useConfig>;

/** Where passwords come from: 1Password through its plugin's secret provider; the others have no engine plugin. */
function Where({ onePassword, config }: Pick<SettingsPageProps, "engine"> & { onePassword: boolean; config: Config }) {
  const choose = async (id: string) => {
    if (id !== "onepassword") return;
    await config.set("plugins.entries.onepassword.enabled", true);
    await config.set("secrets.providers.onepassword", ONEPASSWORD);
  };
  return (
    <Sec title="Where passwords come from" group="Keys">
      <Ctl title="Password manager" sub={onePassword ? "1Password gives Branch a key only where a setting points to it; Branch never shows it." : "Pick the one you use. Branch never sees your passwords."}>
        <Seg label="Password manager" value={onePassword ? "onepassword" : ""} disabled={config.loading} onChange={(id) => void choose(id)}
          options={[{ id: "bitwarden", label: "Bitwarden", off: "Bitwarden needs its engine plugin." }, { id: "onepassword", label: "1Password" }, { id: "windows", label: "Windows", off: "Windows Credential Manager needs its engine plugin." }]} />
      </Ctl>
      <Ctl title="Keys kept apart from settings" sub="Keys stay in a locker only the engine can read." help="Keys live in a locker only the engine reads, so sharing your settings never shares a key.">
        <Btn sm onClick={() => document.getElementById("s2-keys")?.scrollIntoView({ block: "start" })}>Show where</Btn>
      </Ctl>
      <Ctl title="Sign-in tokens" sub="Sign-in tokens are encrypted, refreshed and revoked." help="Tokens from “sign in with…” are encrypted, refreshed before they expire, and revoked when removed." off="Checking them needs the engine’s token report."><Btn sm>Check them</Btn></Ctl>
    </Sec>
  );
}

type Res = ReturnType<typeof useLive<RecordValue>>;
type Dlg = { kind: "add" } | { kind: "edit"; entry: RecordValue } | { kind: "several" } | { kind: "delete"; entry: RecordValue } | null;

/** Keys Branch holds: the engine's key store, protected (secret) or readable by Trunks (env). */
function Keys({ engine, lv, store }: Pick<SettingsPageProps, "engine"> & { lv: number; store: Res }) {
  const [dlg, setDlg] = useState<Dlg>(null);
  const entries = list(rec(store.data).entries);
  const close = (changed: boolean) => { setDlg(null); if (changed) void store.reload(); };
  return (
    <Sec title="Keys Branch holds" showHeading={false} group="Keys" hint="See which keys are set, who changed them and when." help="Which keys are set, who changed them and when; a protected key is never shown." id="s2-keys">
      <Acts><Btn sm ghost onClick={() => setDlg({ kind: "several" })}>Add several</Btn><Btn sm onClick={() => setDlg({ kind: "add" })}><Icon name="plus" small />Add a key</Btn></Acts>
      {store.error ? <p className="hint s2-err" role="alert">{store.error}</p> : null}
      {store.data && !entries.length ? <Empty>No keys yet. Keys you add here, and keys from accounts and connectors, show here.</Empty> : null}
      {entries.length ? <Plist>{entries.map((e) => <KeyRow key={str(e.name)} entry={e} onEdit={() => setDlg({ kind: "edit", entry: e })} onDelete={() => setDlg({ kind: "delete", entry: e })} />)}</Plist> : null}
      {lv >= 2 ? (
        <>
          <CodeRow title="List the keys" code="branch secrets store list" sub="From a terminal on the Gateway’s computer." />
          <CodeRow title="Set a key" code="branch secrets store set NAME" sub="Read a key from a pipe, file or hidden prompt." help="The value comes from a pipe, a file or a hidden prompt, never typed on the command line." />
          <CodeRow title="Remove a key" code="branch secrets store rm NAME" />
          <CodeRow title="Bring in a .env file" code="branch secrets store import --from .env" sub="Reloads keys changed from a terminal." help="After a change from the terminal while the Gateway runs: Reload keys (Keys, technical)." />
        </>
      ) : null}
      {dlg?.kind === "add" || dlg?.kind === "edit" ? <KeyDialog engine={engine} entry={dlg.kind === "edit" ? dlg.entry : undefined} onClose={close} /> : null}
      {dlg?.kind === "several" ? <SeveralDialog engine={engine} onClose={close} /> : null}
      {dlg?.kind === "delete" ? <DeleteDialog engine={engine} entry={dlg.entry} onClose={close} /> : null}
    </Sec>
  );
}

function KeyRow({ entry, onEdit, onDelete }: { entry: RecordValue; onEdit: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const name = str(entry.name);
  const prot = entry.kind === "secret";
  const hosts = (Array.isArray(entry.allowedHosts) ? entry.allowedHosts : []).map(String);
  const items: MenuItem[] = [{ label: "Edit", run: onEdit }, { kind: "sep" }, { label: "Delete", danger: true, run: onDelete }];
  return (
    <div className="prow" data-row={name}>
      <Tile><Ico name="key" s /></Tile>
      <span className="grow">
        <b><code>{name}</code></b>
        <small>{hosts.length ? `Sites: ${hosts.join(", ")}` : "No sites"} · Updated {when(entry.updatedAtMs)}{str(entry.updatedBy) ? ` by ${str(entry.updatedBy)}` : ""}</small>
      </span>
      <Pill tone={prot ? "ok" : "warn"}>{prot ? "Protected" : "Trunks can read it"}</Pill>
      <span className="s2-meta">{prot ? "••••••••" : str(entry.value)}</span>
      <button type="button" className="icon-btn" aria-label={`More for ${name}`} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 160, y: r.bottom + 4 }); }}><Icon name="more" small /></button>
      {menu ? <Menu at={menu} items={items} label={`More for ${name}`} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function hostsOf(text: string): string[] { return [...new Set(text.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean))]; }

/** Add a key / Edit: the name, a value (a protected key can't be read back, so editing asks for it again), who can use it, sites. */
function KeyDialog({ engine, entry, onClose }: Pick<SettingsPageProps, "engine"> & { entry?: RecordValue; onClose: (changed: boolean) => void }) {
  const [name, setName] = useState(str(entry?.name));
  const [value, setValue] = useState(entry?.kind === "env" ? str(entry.value) : "");
  const [kind, setKind] = useState<"secret" | "env">(entry?.kind === "env" ? "env" : "secret");
  const [sites, setSites] = useState((Array.isArray(entry?.allowedHosts) ? entry.allowedHosts : []).join("\n"));
  const call = useCall();
  const nameBad = name !== "" && !NAME_RE.test(name);
  const save = () => void call.run(async () => {
    await engine.request("secrets.store.set", { name, value, kind, ...(kind === "secret" ? { allowedHosts: hostsOf(sites) } : {}) });
    onClose(true);
  });
  return (
    <Dialog title={entry ? `Edit ${str(entry.name)}` : "Add a key"} onClose={() => onClose(false)} footer={<><Btn ghost onClick={() => onClose(false)}>Cancel</Btn><Btn pri disabled={!name || nameBad || !value || call.busy} onClick={save}>Save</Btn></>}>
      <label className="s2-field"><span>Name</span><input className="inp" placeholder="SERVICE_API_KEY" value={name} readOnly={Boolean(entry)} aria-invalid={nameBad} onChange={(e) => setName(e.target.value.toUpperCase())} /></label>
      {nameBad ? <small className="s2-err">Capital letters, digits and _ only, starting with a letter.</small> : null}
      <label className="s2-field"><span>Value</span><textarea className="inp" rows={3} spellCheck={false} autoComplete="off" placeholder={entry?.kind === "secret" ? "Type the new value; the old one can’t be shown." : undefined} value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <div className="s2-field"><span>Who can use it</span>
        <div className="s2-opts" role="radiogroup" aria-label="Who can use it">
          <button type="button" className="s2-opt" role="radio" aria-checked={kind === "secret"} onClick={() => setKind("secret")}><b>Protected</b><small>Hidden once saved. Used only where a setting points to it, or added on the way out to the sites below. Nobody can read it back.</small></button>
          <button type="button" className="s2-opt" role="radio" aria-checked={kind === "env"} onClick={() => setKind("env")}><b>Trunks can read it</b><small>High risk: the owner can see it and Trunks’ commands can read it, so a Trunk could print, send or keep it. Applies from the next run.</small></button>
        </div>
      </div>
      {kind === "secret" ? (
        <>
          <label className="s2-field"><span>Sites it may go to</span><textarea className="inp" rows={2} placeholder="api.example.com" value={sites} onChange={(e) => setSites(e.target.value)} /></label>
          <small className="hint">Exact site names, one per line or separated by commas. No wildcards or ports. A protected key with no site never goes out on its own.</small>
        </>
      ) : null}
      <CallLine call={call} />
    </Dialog>
  );
}

/** Lines of NAME=value, as in a .env file. Comments and blank lines are skipped; quotes around a value are removed. */
export function parseDotenv(text: string): { name: string; value: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const at = l.indexOf("=");
    const name = l.slice(0, at).replace(/^export\s+/, "").trim();
    const value = l.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    return { name, value };
  }).filter((p) => p.name && NAME_RE.test(p.name));
}

function SeveralDialog({ engine, onClose }: Pick<SettingsPageProps, "engine"> & { onClose: (changed: boolean) => void }) {
  const [text, setText] = useState("");
  const [protect, setProtect] = useState(true);
  const call = useCall();
  const pairs = parseDotenv(text);
  const guarded = pairs.filter((p) => protect && KEYLIKE.test(p.name)).length;
  const save = () => void call.run(async () => {
    for (const p of pairs) await engine.request("secrets.store.set", { name: p.name, value: p.value, kind: protect && KEYLIKE.test(p.name) ? "secret" : "env" });
    onClose(true);
  });
  const pick = (file?: File) => { if (file) void file.text().then(setText, (e: unknown) => call.run(() => Promise.reject(e))); };
  return (
    <Dialog title="Add several" onClose={() => onClose(false)} footer={<><Btn ghost onClick={() => onClose(false)}>Cancel</Btn><Btn pri disabled={!pairs.length || call.busy} onClick={save}>Save</Btn></>}>
      <label className="s2-field"><span>Paste NAME=value lines, as in a .env file.</span><textarea className="inp" rows={6} spellCheck={false} autoComplete="off" placeholder="SERVICE_API_KEY=…" value={text} onChange={(e) => setText(e.target.value)} /></label>
      <Acts><label className="btn sm s2-file">Choose a .env file<input type="file" accept=".env,text/plain" onChange={(e) => pick(e.target.files?.[0])} /></label></Acts>
      <label className="s2-chk"><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />Protect key-like names</label>
      <small className="hint">Names ending in _API_KEY, _TOKEN, _PASSWORD, _PRIVATE_KEY or _SECRET. Unticked, every key is readable by Trunks.</small>
      <p className="hint">{guarded} will be protected</p>
      <CallLine call={call} />
    </Dialog>
  );
}

function DeleteDialog({ engine, entry, onClose }: Pick<SettingsPageProps, "engine"> & { entry: RecordValue; onClose: (changed: boolean) => void }) {
  const call = useCall();
  const go = () => void call.run(async () => { await engine.request("secrets.store.delete", { name: str(entry.name) }); onClose(true); });
  return (
    <Dialog title={`Delete ${str(entry.name)}?`} onClose={() => onClose(false)} footer={<><Btn ghost onClick={() => onClose(false)}>Cancel</Btn><Btn className="bad" disabled={call.busy} onClick={go}>Delete</Btn></>}>
      <p>Settings that point to it stop working until it is added again.</p>
      <CallLine call={call} />
    </Dialog>
  );
}

type Finding = { what: string; path: string; note?: string };
/** Plain-text keys (values the engine hides) and pointers to store keys that don't exist. */
export function findings(config: unknown, storeNames: Set<string>, path = ""): Finding[] {
  if (config === REDACTED) return [{ what: "Written in plain text", path }];
  if (!config || typeof config !== "object") return [];
  if (Array.isArray(config)) return config.flatMap((v, i) => findings(v, storeNames, `${path}[${i}]`));
  const o = config as RecordValue;
  if (o.source === "store" && typeof o.id === "string" && typeof o.provider === "string") {
    return storeNames.has(o.id) ? [] : [{ what: "Points to nothing", path, note: o.id }];
  }
  return Object.entries(o).flatMap(([k, v]) => findings(v, storeNames, path ? `${path}.${k}` : k));
}

/** Keys, technical: reload, plain-text findings, the move plan, key sources and the settings file. */
function KeysTechnical({ engine, store, config }: Pick<SettingsPageProps, "engine"> & { store: Res; config: Config }) {
  const [dlg, setDlg] = useState<"" | "plain" | "plan" | "source" | "file">("");
  const reload = useCall();
  const names = new Set(list(rec(store.data).entries).map((e) => str(e.name)));
  const found = findings(config.cfg, names);
  const sources = Object.entries(rec(config.get("secrets.providers")));
  return (
    <Sec title="Keys, technical" showHeading={false} group="Keys">
      <Ctl title="Reload keys" sub={reload.note ?? reload.error ?? "Reads every key source again, without a restart."}>
        <Btn sm disabled={reload.busy} onClick={() => void reload.run(() => engine.request<RecordValue>("secrets.reload", {}), (r) => `Keys reloaded${Number(r.warningCount) ? ` with ${str(r.warningCount)} warnings` : ""}.`)}>Reload</Btn>
      </Ctl>
      <Ctl title="Keys written in plain text" sub="Settings and .env files that hold a key outright, or point to nothing."><Btn sm onClick={() => setDlg("plain")}>Check</Btn></Ctl>
      <Ctl title="Move keys out of settings" sub="Moves plain-text keys into the protected store." help="Moves plain-text keys into the key store and points the settings at them."><Btn sm onClick={() => setDlg("plan")}>Make a plan</Btn></Ctl>
      <h3 className="s2-h3">Where keys can come from</h3>
      <Hint>Settings can point to a key in any of these sources.</Hint>
      <Plist>
        <Prow icon={<Tile><Ico name="term" s /></Tile>} title="Environment" sub="Source name “default”" />
        <Prow icon={<Tile><Ico name="key" s /></Tile>} title="Keys Branch holds" sub="Source name “default”" />
        {sources.map(([alias, p]) => <Prow key={alias} icon={<Tile><Ico name={rec(p).source === "file" ? "doc" : "term"} s /></Tile>} title={alias} sub={SOURCE_WORD[str(rec(p).source)] ?? str(rec(p).source)} />)}
      </Plist>
      <Acts><Btn sm onClick={() => setDlg("source")}>Add a source</Btn></Acts>
      <Ctl title="The settings file" sub="Hidden values stay hidden. Owner only."><Btn sm onClick={() => setDlg("file")}>View</Btn></Ctl>
      {dlg === "plain" ? <FindingsDialog title="Keys written in plain text" found={found} onClose={() => setDlg("")} /> : null}
      {dlg === "plan" ? <FindingsDialog title="Move keys out of settings" found={found.filter((f) => f.what === "Written in plain text")} plan onClose={() => setDlg("")} /> : null}
      {dlg === "source" ? <SourceDialog config={config} onClose={() => setDlg("")} /> : null}
      {dlg === "file" ? <SettingsFileDialog config={config.cfg} onClose={() => setDlg("")} /> : null}
    </Sec>
  );
}
const SOURCE_WORD: Record<string, string> = { env: "Environment", file: "A file", exec: "A command", store: "Keys Branch holds" };

function FindingsDialog({ title, found, plan, onClose }: { title: string; found: Finding[]; plan?: boolean; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p>{found.length ? `${found.length} ${found.length === 1 ? "finding" : "findings"}` : "Nothing found. Every key is in the key store or a source."}</p>
      {found.length ? <div className="rows">{found.map((f) => <Prow key={f.path} title={f.what} sub={`${f.path}${f.note ? ` → ${f.note}` : ""}`} />)}</div> : null}
      {plan && found.length ? <><p className="hint">The values stay hidden from this window, so the move runs on the Gateway’s computer:</p><CodeRow title="Make and apply the plan" code="branch secrets configure" /></> : null}
    </Dialog>
  );
}

/** Add a source: a file or a command the engine reads keys from (secrets.providers.<name>). */
function SourceDialog({ config, onClose }: { config: Config; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("file");
  const [where, setWhere] = useState("");
  const call = useCall();
  const bad = name !== "" && !/^[a-z][a-z0-9_-]{0,63}$/.test(name);
  const add = () => void call.run(async () => {
    const ok = await config.set(`secrets.providers.${name}`, kind === "file" ? { source: "file", path: where } : { source: "exec", command: where });
    if (!ok) throw new Error("The engine didn’t save the source. See the line at the top.");
    onClose();
  });
  return (
    <Dialog title="Add a source" onClose={onClose} footer={<><Btn ghost onClick={onClose}>Cancel</Btn><Btn pri disabled={!name || bad || !where || call.busy} onClick={add}>Add</Btn></>}>
      <label className="s2-field"><span>Name</span><input className="inp" placeholder="vault" value={name} aria-invalid={bad} onChange={(e) => setName(e.target.value)} /></label>
      <Ctl title="Kind" sub={kind === "file" ? "JSON or a single value; waits up to 5 s, reads up to 1 MiB." : "A program that prints the key; it must be a full path."}>
        <Seg label="Kind" value={kind} options={[{ id: "file", label: "A file" }, { id: "exec", label: "A command" }]} onChange={setKind} />
      </Ctl>
      <label className="s2-field"><span>{kind === "file" ? "File" : "Command"}</span><input className="inp" placeholder={kind === "file" ? "C:\\keys\\branch.json" : "C:\\tools\\get-key.exe"} value={where} onChange={(e) => setWhere(e.target.value)} /></label>
      <CallLine call={call} />
    </Dialog>
  );
}

function leaves(value: unknown, path = ""): [string, string][] {
  if (value === null || typeof value !== "object") return [[path, value === REDACTED ? "" : String(value)]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  return Object.entries(value as RecordValue).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

function SettingsFileDialog({ config, onClose }: { config: RecordValue; onClose: () => void }) {
  const rows = leaves(config);
  return (
    <Dialog title="The settings file" wide onClose={onClose}>
      {rows.length ? <div className="rows">{rows.map(([path, value]) => <Prow key={path} title={<code>{path}</code>} sub={value === "" ? "Hidden." : value} />)}</div> : <p className="hint">The settings file is empty: Branch runs on its defaults.</p>}
    </Dialog>
  );
}
