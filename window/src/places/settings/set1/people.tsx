// Settings › People (DESIGN-SPEC §4.7.2): your profile head, everyone who uses Branch grouped by where they use it,
// the chosen person's card, Each person, and at Advanced the records and how people sign in. Reads users.list,
// users.self, system-presence and gateway.roles; the card's actions and your own name and picture save through
// users.setRole, device.pair.setupCode, device.token.revoke, users.setDisplayName and users.setAvatar.
import { useRef, useState } from "react";
import type { SettingsPageProps } from "../index";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Icon } from "../../../shell/icons";
import { Btn, Empty, Hint, Page, Pill, Status, useConfig, useLevel, type RowEntry } from "../kit";
import { GROUPS, ago, connsOf, keptDevices, faceColour, groupOf, initials, lastActive, profilesOf, roleOf, rolesOf, type Conn, type Group, type Profile, type Roles } from "./people-data";
import { PersonCard } from "./people-card";
import { InviteDialog } from "../../people/person-dialogs";
import { usePicture, type Picture } from "./people-mine";
import { EachPerson, Records } from "./people-more";
import "./people.css";

export type People = {
  engine: SettingsPageProps["engine"]; people: Profile[]; self: Profile | null; conns: Conn[]; roles: Roles; admin: boolean;
  keep: Set<string>; trunks: Map<string, string>; reload: () => Promise<void>; openSettings?: (page: string) => void; pic: Picture;
};

const LEDE = "Everyone who uses Branch, on this computer or their own.";
const HELP = "Everyone who uses Branch: on this computer, on their own devices, and your keepoak.com team. The same list as People › People in the People place.";

export function PeoplePage(props: SettingsPageProps) {
  const lv = useLevel();
  const ctx = usePeople(props);
  const [selId, setSel] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const sel = ctx.people.find((p) => p.id === selId) ?? ctx.self ?? ctx.people[0] ?? null;
  return (
    <Page title={props.title} lede={LEDE} help={HELP}>
      {ctx.error ? <Status tone="bad" title="Branch couldn’t read who uses it">{visible(ctx.error)}</Status> : null}
      <div className="t10-pp">
        <div className="plist-pp">
          {ctx.self ? <ProfileHead ctx={ctx} me={ctx.self} /> : null}
          <PersonList ctx={ctx} sel={sel} onSel={setSel} loading={ctx.loading} />
          <Btn pri className="invite-pp" onClick={() => setInvite(true)}><Icon name="plus" small />Invite someone</Btn>
        </div>
        {sel ? <PersonCard key={sel.id} ctx={ctx} p={sel} /> : null}
      </div>
      <Hint>Separation on one computer, not separate accounts. Each person’s conversations and memory are their own.</Hint>
      <EachPerson />
      {lv >= 1 ? <Records engine={props.engine} trunks={ctx.trunks} /> : null}
      {invite ? <InviteDialog engine={props.engine} onClose={() => { setInvite(false); void ctx.reload(); }} /> : null}
    </Page>
  );
}

function usePeople(props: SettingsPageProps): People & { loading: boolean; error?: string } {
  const users = useResource<RecordValue>(props.engine, "users.list", {});
  const me = useResource<RecordValue>(props.engine, "users.self", {});
  const presence = useResource<unknown>(props.engine, "system-presence", {});
  const presenceData = useLast(presence.data);
  const agents = useResource<RecordValue>(props.engine, "agents.list", {});
  const cfg = useConfig(props.engine);
  const listed = profilesOf(useLast(users.data));
  const meData = useLast(me.data);
  const selfId = typeof record(meData?.profile).id === "string" ? String(record(meData?.profile).id) : null;
  // users.self names the signed-in person even when users.list hasn't caught up yet.
  const mine = selfId && !listed.some((p) => p.id === selfId) ? profilesOf({ profiles: [meData?.profile] }) : [];
  const people = [...mine, ...listed];
  const self = people.find((p) => p.id === selfId) ?? null;
  const reload = async () => { await Promise.all([users.reload(), me.reload(), presence.reload()]); };
  const pic = usePicture(props.engine, self, reload);
  const trunks = new Map(list(agents.data?.agents).map((a) => [String(a.id), visible(record(a.identity).name ?? a.name ?? a.id)]));
  return {
    engine: props.engine, people, self, conns: connsOf(presenceData), keep: keptDevices(presenceData, selfId), roles: rolesOf(cfg.get("gateway.roles")), trunks, reload, pic,
    admin: props.engine.scopes.includes("operator.admin"), openSettings: props.openSettings, loading: users.loading, error: users.error,
  };
}

/** The last answer while a reload is on its way, so a save doesn't blank the page. */
function useLast<T>(value: T | undefined): T | undefined {
  const last = useRef(value);
  if (value !== undefined) last.current = value;
  return last.current;
}

/** A person's face: their picture when you just set yours, else their initials on their colour. */
export function Face({ p, size, pic }: { p: Profile; size: number; pic?: string | null }) {
  if (pic) return <span className="face-pp" style={{ width: size, height: size }}><img src={pic} alt={p.name} /></span>;
  return <span className="face-pp" aria-hidden="true" style={{ width: size, height: size, background: faceColour(p.id), color: p.owner ? "var(--on-btn)" : undefined, fontSize: Math.round(size * 0.36) }}>{initials(p.name)}</span>;
}

function ProfileHead({ ctx, me }: { ctx: People; me: Profile }) {
  const role = roleOf(me, ctx.roles);
  return (
    <div className="phead-pp">
      <label className="phface-pp" title="Change your picture">
        <Face p={me} size={56} pic={ctx.pic.url} />
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Change your picture" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) ctx.pic.pick(f); }} />
      </label>
      <span className="grow"><b>{visible(me.name)}</b></span>
      {role ? <Pill tone={me.owner ? "ok" : "idle"}>{visible(role)}</Pill> : null}
    </div>
  );
}

function PersonList({ ctx, sel, onSel, loading }: { ctx: People; sel: Profile | null; onSel: (id: string) => void; loading: boolean }) {
  if (!loading && !ctx.people.length) return <Empty>Only you use Branch so far.</Empty>;
  const groups = (Object.keys(GROUPS) as Group[]).map((g) => [g, ctx.people.filter((p) => groupOf(p, ctx.conns) === g)] as const).filter(([, ps]) => ps.length);
  return (
    <>
      {groups.map(([g, ps]) => (
        <div key={g} className="pgrp-pp">
          <div className="grp-pp">{GROUPS[g]}</div>
          {ps.map((p) => <PersonItem key={p.id} ctx={ctx} p={p} current={sel?.id === p.id} onSel={onSel} />)}
        </div>
      ))}
    </>
  );
}

function PersonItem({ ctx, p, current, onSel }: { ctx: People; p: Profile; current: boolean; onSel: (id: string) => void }) {
  const last = lastActive(ctx.conns.filter((c) => c.profileId === p.id));
  const sub = [visible(roleOf(p, ctx.roles)), last !== undefined ? `last used ${ago(last)}` : ""].filter(Boolean).join(" · ");
  return (
    <button type="button" className="pitem-pp" aria-current={current} onClick={() => onSel(p.id)}>
      <Face p={p} size={34} pic={p.id === ctx.self?.id ? ctx.pic.url : null} />
      <span className="grow"><b>{visible(p.name)}{p.id === ctx.self?.id ? " · you" : ""}</b>{sub ? <small>{sub}</small> : null}</span>
    </button>
  );
}

const row = (sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "people", title, sec, group: sec, lv }));
export const PEOPLE_ROWS: RowEntry[] = [
  ...row("You", 0, ["Your own instructions", "Your own accounts"]),
  ...row("Each person", 0, ["Open People", "Groups", "Signing in from other devices", "What you share"]),
  ...row("Records", 1, ["Signed household records"]),
];
