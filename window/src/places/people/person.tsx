// People › People (§4.6.5.2): the list of everyone (grouped by how they reach Branch) and the selected person's card.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { shownWhy } from "../../shell/shown-why";
import { Icon } from "../../shell/icons";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { useResource } from "../library/data";
import { ACTIVITY_WORD, OWNER_ID, activeProfiles, activityOf, ago, deviceKind, deviceName, firstName, nameOf, presence, presenceOf, profiles, reachOf, roleDefinition, roleNames, rows, secondsAgo, strs, type Presence, type Profile } from "./data";
import { CodeDialog, InviteDialog, LinkEmailDialog, MergeDialog, RoleSeg } from "./person-dialogs";
import { Avatar, Section, Seg, Status, copyText } from "./ui";
import { keptDevices, revokePlan } from "../settings/set1/people-data";

type Res = ReturnType<typeof useResource<unknown>>;
export const MAY = ["Look things up", "Use web pages", "Write files", "Run commands", "Send messages", "Spend money", "Change how Branch is set up"];
export const MAY_OFF = "Needs the engine's per-person permissions.";
export const PIN_OFF = "Needs the engine's PIN store.";
export const SWITCH_OFF = "Needs the engine's profile switch.";
export const REMOVE_OFF = "Needs the engine's remove-a-person method.";
const HOW = { this: "On this computer", device: "On their own device" } as const;
type How = keyof typeof HOW;

/** The role as the preview words it: "Owner", "Adult", "Child" (engine role ids are lower-case keys). */
export const roleWord = (p: Profile) => p.id === OWNER_ID ? "Owner" : p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : "No role";
/** Connected from another device puts someone under "On their own device"; anyone else, connected here or not
 *  connected now, is under the preview's "On this computer". */
const howOf = (p: Profile, conns: Presence[]): How => p.id !== OWNER_ID && reachOf(presenceOf(conns, p.id)) === "device" ? "device" : "this";
const lastUsed = (entries: Presence[]) => { const at = Math.max(0, ...entries.map(e => e.lastActivityAt ?? 0)); return at ? ago(at) : ""; };

type Props = { engine: WindowEngine; users: Res; me: string | null; level: Level; selected: string | null; onSelect: (id: string) => void; openConversation: (key: string) => void };
export function PeopleTab({ engine, users, me, level, selected, onSelect, openConversation }: Props) {
  const live = useResource<unknown>(engine, "system-presence");
  const config = useResource<unknown>(engine, "config.get");
  const [invite, setInvite] = useState(false);
  const people = activeProfiles(profiles(users.data));
  const conns = presence(live.data);
  const mine = people.find(p => p.id === me);
  const current = people.find(p => p.id === selected) ?? people.find(p => p.id !== me) ?? mine ?? people[0];
  return <>
    <Status {...users} />
    {users.data != null && <div className="pp-two">
      <div className="pp-list">
        {mine && <div className="pp-head"><Avatar id={mine.id} name={nameOf(mine)} size={56} activity={activityOf(presenceOf(conns, mine.id))} /><span className="grow"><b>{nameOf(mine)}</b></span><span className={mine.id === OWNER_ID ? "pill ok" : "pill idle"}>{roleWord(mine)}</span></div>}
        {(Object.keys(HOW) as How[]).map(how => { const group = people.filter(p => howOf(p, conns) === how);
          return group.length ? <div key={how} className="pp-list"><div className="pp-grp">{HOW[how]}</div>
            {group.map(p => { const mineConns = presenceOf(conns, p.id), used = lastUsed(mineConns);
              return <button key={p.id} type="button" className="pp-item" aria-current={p.id === current?.id} onClick={() => onSelect(p.id)}>
                <Avatar id={p.id} name={nameOf(p)} size={34} activity={activityOf(mineConns)} />
                <span className="grow"><b>{nameOf(p)}{p.id === me ? " · you" : ""}</b><small>{roleWord(p)}{used && ` · last used ${used}`}</small></span>
              </button>; })}</div> : null; })}
        <button type="button" className="btn pri pp-invite" onClick={() => setInvite(true)}><Icon name="plus" small />Invite someone</button>
      </div>
      {current && <Detail key={current.id} engine={engine} person={current} me={me} people={people} conns={conns} presenceData={live.data} config={config.data} level={level} reload={users.reload} openConversation={openConversation} />}
    </div>}
    <p className="pp-hint">Separation on one computer, not separate accounts. Each person's conversations and memory are their own.</p>
    {invite && <InviteDialog engine={engine} onClose={() => setInvite(false)} />}
  </>;
}

type DetailProps = { engine: WindowEngine; person: Profile; me: string | null; people: Profile[]; conns: Presence[]; presenceData: unknown; config: unknown; level: Level; reload: () => void; openConversation: (key: string) => void };
function Detail({ engine, person, me, people, conns, presenceData, config, level, reload, openConversation }: DetailProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const theirs = presenceOf(conns, person.id);
  const owner = person.id === OWNER_ID;
  const reach = theirs.length ? theirs.map(deviceName).join(", ") : "Not connected now";
  return <div className="pp-detail">
    <div className="pp-dh"><Avatar id={person.id} name={nameOf(person)} size={44} activity={activityOf(theirs)} />
      <span className="grow"><b>{nameOf(person)}</b><small>{reach}</small>
        {shows(level, "technical") && <small className="pp-id"><code>{person.id}</code><button type="button" className="btn ghost sm" onClick={() => { void copyText(person.id).then(ok => setCopied(ok ? "Copied." : "Couldn't copy.")); }}>Copy</button>{copied && <span role="status" className="pp-mut">{copied}</span>}</small>}
      </span><span className={owner ? "pill ok" : "pill idle"}>{roleWord(person)}</span></div>
    <Section title="May">
      <div className="pp-may" title={owner ? undefined : shownWhy(MAY_OFF)}>{MAY.map(m => <label key={m} className={owner ? "pp-chk" : "pp-chk no"}><input type="checkbox" checked={owner} disabled aria-label={m} readOnly /> {m}</label>)}</div>
      {!owner && shownWhy(MAY_OFF) && <p className="pp-hint" style={{ marginTop: 8 }}>{shownWhy(MAY_OFF)}</p>}
    </Section>
    <Facts person={person} theirs={theirs} config={config} signedOut={signedOut} />
    {owner ? <p className="pp-hint">You're the owner. Only you change how Branch is set up.</p> : null}
    <Now engine={engine} person={person} theirs={theirs} openConversation={openConversation} />
    {!owner && <Actions engine={engine} person={person} me={me} people={people} conns={conns} presenceData={presenceData} config={config} level={level} reload={reload} signedOut={signedOut} onSignOut={() => setSignedOut(true)} />}
  </div>;
}

function Facts({ person, theirs, config, signedOut }: { person: Profile; theirs: Presence[]; config: unknown; signedOut: boolean }) {
  const def = roleDefinition(config, person.role);
  const agents = person.id === OWNER_ID || def?.agents === "*" ? "Every Trunk" : def ? strs(def.agents).join(", ") || "None" : "";
  return <dl className="kv">
    {agents && <><dt>Trunks</dt><dd>{agents}</dd></>}
    {shownWhy(PIN_OFF) && <><dt>PIN</dt><dd className="pp-why">{shownWhy(PIN_OFF)}</dd></>}
    <dt>Signed in on</dt><dd>{signedOut ? "Nothing right now" : theirs.length ? theirs.map(deviceName).join(", ") : "Nothing right now"}</dd>
    {person.emails.length > 0 && <><dt>Emails</dt><dd title="Email addresses connected to this person.">{person.emails.join(", ")}</dd></>}
  </dl>;
}

const PERIODS = [{ id: "1", name: "Last 24 hours" }, { id: "7", name: "Last 7 days" }, { id: "30", name: "Last 30 days" }, { id: "all", name: "All time" }];
function Now({ engine, person, theirs, openConversation }: { engine: WindowEngine; person: Profile; theirs: Presence[]; openConversation: (key: string) => void }) {
  const [period, setPeriod] = useState("7");
  const recent = useResource<unknown>(engine, "sessions.list", { profileRelation: { profileId: person.id, relationship: "involving" }, includeDerivedTitles: true, limit: 50 });
  const act = activityOf(theirs);
  const since = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
  const list = rows(recent.data).filter(r => (r.updatedAt ?? 0) >= since);
  const watched = theirs.flatMap(t => t.watched)[0];
  const look = watched ? rows(recent.data).find(r => r.key === watched) : undefined;
  return <Section title="Now">
    <p className="pp-state"><i className={`pp-dot ${act ?? ""}`} />{act ? `Online · ${ACTIVITY_WORD[act].toLowerCase()}` : "Offline"}</p>
    {theirs.length > 0 && <dl className="kv">{theirs.map((t, i) => <DeviceFact key={i} p={t} />)}</dl>}
    <p className="pp-look">{look ? <>Looking at now: <button type="button" className="link" onClick={() => openConversation(look.key)}>{look.title}</button></> : "Not looking at a conversation right now."}</p>
    <div className="pp-rec-h"><b>Recent conversations</b><Seg label="Recent conversations" value={period} options={PERIODS} onChange={setPeriod} /></div>
    <Status {...recent} />
    {recent.data != null && !list.length && <p className="pp-hint">No recent conversations you can see.</p>}
    <ul className="pp-rec">{list.slice(0, 8).map(r => <li key={r.key}><button type="button" className="link" onClick={() => openConversation(r.key)}>{r.title}</button><small>{ago(r.updatedAt)}</small></li>)}</ul>
    <p className="pp-hint" style={{ margin: "6px 0 0" }}>Only conversations you may see are listed.</p>
  </Section>;
}
function DeviceFact({ p }: { p: Presence }) {
  const line = [deviceKind(p), p.platform, p.ip, p.timeZone].filter(Boolean).join(" · ");
  return <><dt>{deviceName(p)}</dt><dd>{line}{p.lastInputSeconds !== undefined && <><br /><small className="pp-mut">Last input {secondsAgo(p.lastInputSeconds)}</small></>}</dd></>;
}

type ActionProps = { engine: WindowEngine; person: Profile; me: string | null; people: Profile[]; conns: Presence[]; presenceData: unknown; config: unknown; level: Level; reload: () => void; signedOut: boolean; onSignOut: () => void };
function Actions({ engine, person, me, people, conns, presenceData, config, level, reload, signedOut, onSignOut }: ActionProps) {
  const [open, setOpen] = useState<"code" | "link" | "merge" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = firstName(nameOf(person));
  const owner = me === OWNER_ID;
  
  const keep = keptDevices(presenceData, me);
  const devices = conns.filter(c => c.profileId === person.id && c.deviceId && !keep.has(c.deviceId)).map(c => c.deviceId);
  
  const signOut = async () => {
    setError(null);
    try {
      const paired = await engine.request<unknown>("device.pair.list", {});
      const plan = revokePlan(devices, keep, paired);
      
      if (!plan.length) throw new Error("Branch found no sign-in to end on their devices.");
      
      for (const t of plan) {
        await engine.request("device.token.revoke", t);
      }
      
      onSignOut();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed.");
    }
  };
  
  const signOutWhy = !owner ? "Only the owner can do this." : !devices.length ? `No device of ${first}'s is connected now.` : undefined;
  const signOutDisabled = signedOut || Boolean(signOutWhy);
  
  return <div className="pp-acts" style={{ marginTop: 14 }}>
    <button type="button" className="btn sm" disabled title={shownWhy(SWITCH_OFF)}>Switch to {first}</button>
    <RoleSeg engine={engine} person={person} roles={roleNames(config)} reload={reload} />
    <button type="button" className="btn ghost sm" onClick={() => setOpen("code")}>Make a one-time code</button>
    <button type="button" className="btn ghost sm" disabled={signOutDisabled} title={shownWhy(signOutWhy)} onClick={() => void signOut()}>Sign out everywhere</button>
    <button type="button" className="btn ghost sm" disabled title={shownWhy(REMOVE_OFF)}>Remove</button>
    {shows(level, "advanced") && <><button type="button" className="btn ghost sm" onClick={() => setOpen("link")}>Link an email…</button><button type="button" className="btn ghost sm" onClick={() => setOpen("merge")}>Merge into…</button></>}
    {error && <p className="pp-hint" style={{ marginTop: 8, color: "var(--bad)" }}>{error}</p>}
    {open === "code" && <CodeDialog engine={engine} title={`A one-time code for ${first}`} onClose={() => setOpen(null)} />}
    {open === "link" && <LinkEmailDialog engine={engine} person={person} onClose={() => setOpen(null)} onDone={reload} />}
    {open === "merge" && <MergeDialog engine={engine} person={person} others={people.filter(p => p.id !== person.id && p.id !== me && p.id !== OWNER_ID)} onClose={() => setOpen(null)} onDone={reload} />}
  </div>;
}
