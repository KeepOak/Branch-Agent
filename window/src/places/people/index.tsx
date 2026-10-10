// People (§4.6.5): everyone who uses Branch, what their Trunks are doing, what is shared, and how people sign in.
// Wired to engine users.*, system-presence, sessions.*, device.pair.*, audit.activity.list, sessions.usage and config.
import { useEffect, useState } from "react";
import { Icon } from "../../shell/icons";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import { useResource } from "../library/data";
import { activeProfiles, profiles, rec, rows, str } from "./data";
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
import "./people.css";

export type TabId = "live" | "people" | "groups" | "shared" | "agents" | "activity" | "usage" | "rules" | "signin";
/** The four top tabs (DA-50): nine in a row ran past the content column, so Team and Access each hold a row of views. */
export type TopId = "team" | "activity" | "access" | "usage";
type TeamView = "live" | "people" | "agents";
type AccessView = "signin" | "shared" | "groups" | "rules";
/** The optional-team banner shows on these views only (§4.6.5 shared header parts). */
const BANNER: TabId[] = ["live", "agents", "activity", "usage", "rules"];
const TOP_NAMES: [TopId, string][] = [["team", "Team"], ["activity", "Activity"], ["access", "Access"], ["usage", "Usage"]];
const TEAM_NAMES: [TeamView, string][] = [["live", "Live now"], ["people", "People"], ["agents", "Teams"]];
const ACCESS_NAMES: [AccessView, string][] = [["signin", "Signing in"], ["shared", "Shared"], ["groups", "Access groups"], ["rules", "Rules"]];
/** Every name a "branch:place-tab" event may use, old views included, and where it lands. */
const ROUTES: [string, string, TopId, TabId | null][] = [...TOP_NAMES.map(([id, name]): [string, string, TopId, null] => [id, name, id, null]),
  ...TEAM_NAMES.map(([id, name]): [string, string, TopId, TabId] => [id, name, "team", id]), ...ACCESS_NAMES.map(([id, name]): [string, string, TopId, TabId] => [id, name, "access", id])];

export function PeoplePlace({ engine, openConversation, openSettings, level }: PlaceProps) {
  const [tab, setTab] = useState<TopId>("team");
  const [teamView, setTeamView] = useState<TeamView>("live");
  const [accessView, setAccessView] = useState<AccessView>("signin");
  const [person, setPerson] = useState<string | null>(null);
  const users = useResource<unknown>(engine, "users.list");
  const self = useResource<unknown>(engine, "users.self");
  const runs = useResource<unknown>(engine, "sessions.list", { activeOnly: true, includeDerivedTitles: true, includeLastMessage: true });
  const { reload: reloadUsers } = users, { reload: reloadRuns } = runs;
  useEffect(() => engine.onEvent(({ event }) => {
    if (event === "users.changed") reloadUsers();
    if (event === "sessions.changed") reloadRuns();
  }), [engine, reloadUsers, reloadRuns]);
  useEffect(() => {
    const onTab = (e: Event) => { const d = rec((e as CustomEvent).detail); if (str(d.place) !== "people") return;
      const want = str(d.tab).toLowerCase(); const hit = ROUTES.find(([id, name]) => id === want || name.toLowerCase() === want); if (!hit) return;
      setTab(hit[2]); if (hit[2] === "team" && hit[3]) setTeamView(hit[3] as TeamView); if (hit[2] === "access" && hit[3]) setAccessView(hit[3] as AccessView); };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
  const me = str(rec(rec(self.data).profile).id) || null;
  const people = activeProfiles(profiles(users.data));
  const running = rows(runs.data).filter(r => r.working && !r.helper).length;
  const seePerson = (id: string) => { setPerson(id); setTab("team"); setTeamView("people"); };
  const tabs = TOP_NAMES.map(([id, name]) => ({ id, name }));
  const teamTabs = TEAM_NAMES.map(([id, name]) => ({ id, name, count: id === "live" && runs.data ? running : id === "people" && users.data ? people.length : undefined }));
  const accessTabs = ACCESS_NAMES.map(([id, name]) => ({ id, name }));
  const view: TabId = tab === "team" ? teamView : tab === "access" ? accessView : tab;
  return <PlaceFrame title="People" lede="Everyone who uses Branch: on this computer, on their own devices, and your keepoak.com team.">
    <div className="ppl">
      {BANNER.includes(view) && <div className="pp-banner"><span className="pp-tile"><Icon name="users" small /></span><span className="grow"><b>Your keepoak.com team is optional</b><small>People on this computer and on their own devices work without it.</small></span>
        {openSettings && <button type="button" className="btn pri sm" onClick={() => openSettings("accounts")}>Connect</button>}</div>}
      <Tabs label="People" tabs={tabs} value={tab} onChange={setTab} />
      {tab === "team" && <Tabs label="Team" sub tabs={teamTabs} value={teamView} onChange={setTeamView} />}
      {tab === "access" && <Tabs label="Access" sub tabs={accessTabs} value={accessView} onChange={setAccessView} />}
      {view === "live" ? <LiveNow engine={engine} users={users} runs={runs} me={me} openConversation={openConversation} onPerson={seePerson} />
        : view === "people" ? <PeopleTab engine={engine} users={users} me={me} level={level} selected={person} onSelect={setPerson} openConversation={openConversation} />
        : view === "groups" ? <GroupsTab />
        : view === "shared" ? <SharedTab engine={engine} me={me} level={level} openConversation={openConversation} />
        : view === "agents" ? <TeamsTab engine={engine} />
        : view === "activity" ? <ActivityTab engine={engine} level={level} />
        : view === "usage" ? <UsageTab engine={engine} />
        : view === "rules" ? <RulesTab />
        : <SigninTab engine={engine} level={level} openSettings={openSettings} />}
    </div>
  </PlaceFrame>;
}
