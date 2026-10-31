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
/** The optional-team banner shows on these tabs only (§4.6.5 shared header parts). */
const BANNER: TabId[] = ["live", "agents", "activity", "usage", "rules"];
/** People opens on the tab that lists people (DA-51); Live now stays one click away. */
const TAB_NAMES: [TabId, string][] = [["people", "People"], ["live", "Live now"], ["groups", "Access groups"], ["shared", "Shared"], ["agents", "Teams"], ["activity", "Activity"], ["usage", "Usage"], ["rules", "Rules"], ["signin", "Signing in"]];

export function PeoplePlace({ engine, openConversation, openSettings, level }: PlaceProps) {
  const [tab, setTab] = useState<TabId>("people");
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
      const want = str(d.tab).toLowerCase(); const hit = TAB_NAMES.find(([id, name]) => id === want || name.toLowerCase() === want); if (hit) setTab(hit[0]); };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
  const me = str(rec(rec(self.data).profile).id) || null;
  const people = activeProfiles(profiles(users.data));
  const running = rows(runs.data).filter(r => r.working && !r.helper).length;
  const seePerson = (id: string) => { setPerson(id); setTab("people"); };
  const tabs = TAB_NAMES.map(([id, name]) => ({ id, name, count: id === "live" && runs.data ? running : id === "people" && users.data ? people.length : undefined }));
  return <PlaceFrame title="People" lede="Everyone who uses Branch: on this computer, on their own devices, and your keepoak.com team.">
    <div className="ppl">
      {BANNER.includes(tab) && <div className="pp-banner"><span className="pp-tile"><Icon name="users" small /></span><span className="grow"><b>Your keepoak.com team is optional</b><small>People on this computer and on their own devices work without it.</small></span>
        {openSettings && <button type="button" className="btn pri sm" onClick={() => openSettings("accounts")}>Connect</button>}</div>}
      <Tabs label="People" tabs={tabs} value={tab} onChange={setTab} />
      {tab === "live" ? <LiveNow engine={engine} users={users} runs={runs} me={me} openConversation={openConversation} onPerson={seePerson} />
        : tab === "people" ? <PeopleTab engine={engine} users={users} me={me} level={level} selected={person} onSelect={setPerson} openConversation={openConversation} />
        : tab === "groups" ? <GroupsTab />
        : tab === "shared" ? <SharedTab engine={engine} me={me} level={level} openConversation={openConversation} />
        : tab === "agents" ? <TeamsTab engine={engine} />
        : tab === "activity" ? <ActivityTab engine={engine} level={level} />
        : tab === "usage" ? <UsageTab engine={engine} />
        : tab === "rules" ? <RulesTab />
        : <SigninTab engine={engine} level={level} openSettings={openSettings} />}
    </div>
  </PlaceFrame>;
}
