// People (§4.6.5): everyone who uses Branch, what their Trunks are doing, what is shared, and how people sign in.
// Wired to engine users.*, system-presence, sessions.*, device.pair.*, audit.activity.list, sessions.usage and config.
// The place opens on a simple "You + invite" view. "Team admin" opens the full set of tabs, and every tab stays reachable from there.
import { useEffect, useState } from "react";
import { Icon } from "../../shell/icons";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import { useResource } from "../library/data";
import { activeProfiles, profiles, rec, str } from "./data";
import { ActivityTab } from "./activity";
import { GroupsTab } from "./groups";
import { LiveNow } from "./live";
import { PeopleTab } from "./person";
import { RulesTab } from "./rules";
import { SharedTab } from "./shared";
import { SigninTab } from "./signin";
import { TeamsTab } from "./teams";
import { UsageTab } from "./usage";
import { Tabs } from "./ui";
import { YouAndInvite } from "./simple";
import { RUNS_PARAMS, workingRows } from "./working";
import "./people.css";

export type TabId = "live" | "people" | "groups" | "shared" | "agents" | "activity" | "usage" | "rules" | "signin";
const TAB_NAMES: [TabId, string][] = [["live", "Live now"], ["people", "People"], ["groups", "Access groups"], ["shared", "Shared"], ["agents", "Teams"], ["activity", "Activity"], ["usage", "Usage"], ["rules", "Rules"], ["signin", "Signing in"]];
/** The optional-team banner shows on these tabs only (§4.6.5 shared header parts). */
const BANNER: TabId[] = ["live", "agents", "activity", "usage", "rules"];

type TabBodyProps = PlaceProps & { tab: TabId; me: string | null; users: ReturnType<typeof useResource<unknown>>; runs: ReturnType<typeof useResource<unknown>>; person: string | null; setPerson: (id: string | null) => void; seePerson: (id: string) => void };
function TabBody({ tab, engine, openConversation, openSettings, level, me, users, runs, person, setPerson, seePerson }: TabBodyProps) {
  if (tab === "live") return <LiveNow engine={engine} users={users} runs={runs} me={me} openConversation={openConversation} onPerson={seePerson} />;
  if (tab === "people") return <PeopleTab engine={engine} users={users} me={me} level={level} selected={person} onSelect={setPerson} openConversation={openConversation} />;
  if (tab === "groups") return <GroupsTab />;
  if (tab === "shared") return <SharedTab engine={engine} me={me} level={level} openConversation={openConversation} />;
  if (tab === "agents") return <TeamsTab engine={engine} />;
  if (tab === "activity") return <ActivityTab engine={engine} level={level} />;
  if (tab === "usage") return <UsageTab engine={engine} />;
  if (tab === "rules") return <RulesTab />;
  return <SigninTab engine={engine} level={level} openSettings={openSettings} />;
}

export function PeoplePlace(props: PlaceProps) {
  const { engine, openSettings } = props;
  const [tab, setTab] = useState<TabId>("live");
  const [admin, setAdmin] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const users = useResource<unknown>(engine, "users.list");
  const self = useResource<unknown>(engine, "users.self");
  const runs = useResource<unknown>(engine, "sessions.list", RUNS_PARAMS);
  const { reload: reloadUsers } = users, { reload: reloadRuns } = runs;
  useEffect(() => engine.onEvent(({ event }) => {
    if (event === "users.changed") reloadUsers();
    if (event === "sessions.changed") reloadRuns();
  }), [engine, reloadUsers, reloadRuns]);
  useEffect(() => {
    const onTab = (e: Event) => { const d = rec((e as CustomEvent).detail); if (str(d.place) !== "people") return;
      const want = str(d.tab).toLowerCase(); const hit = TAB_NAMES.find(([id, name]) => id === want || name.toLowerCase() === want);
      if (hit) { setTab(hit[0]); setAdmin(true); } };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
  const me = str(rec(rec(self.data).profile).id) || null;
  const people = activeProfiles(profiles(users.data));
  const you = people.find((p) => p.id === me);
  const running = workingRows(runs.data).length;
  const seePerson = (id: string) => { setPerson(id); setTab("people"); setAdmin(true); };
  const tabs = TAB_NAMES.map(([id, name]) => ({ id, name, count: id === "live" && runs.data ? running : id === "people" && users.data ? people.length : undefined }));
  const lede = "Everyone who uses Branch: on this computer, on their own devices, and your keepoak.com team.";
  if (!admin) return <PlaceFrame title="People" lede={lede}><div className="ppl"><YouAndInvite engine={engine} users={users} you={you} onTeamAdmin={() => setAdmin(true)} /></div></PlaceFrame>;
  return <PlaceFrame title="People" lede={lede}>
    <div className="ppl">
      {BANNER.includes(tab) && <div className="pp-banner"><span className="pp-tile"><Icon name="users" small /></span><span className="grow"><b>Your keepoak.com team is optional</b><small>People on this computer and on their own devices work without it.</small></span>
        {openSettings && <button type="button" className="btn pri sm" onClick={() => openSettings("accounts")}>Connect</button>}</div>}
      <div className="pp-admin-top"><button type="button" className="btn ghost sm" onClick={() => setAdmin(false)}>Back to you</button></div>
      <Tabs label="People" tabs={tabs} value={tab} onChange={setTab} />
      <TabBody {...props} tab={tab} me={me} users={users} runs={runs} person={person} setPerson={setPerson} seePerson={seePerson} />
    </div>
  </PlaceFrame>;
}
