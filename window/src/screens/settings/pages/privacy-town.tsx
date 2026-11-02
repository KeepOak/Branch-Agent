// Town lookup on Settings › Privacy. The on/off switch is Regular, because town lookup is on unless turned off. The list,
// its credit and how often it refreshes are Technical. Adding your town to messages has no setting yet, so that row stays grey.
import type { ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { RowView } from "../RowView";
import { cardRows, type Row } from "../rows";
import type { PageSlot, SlotPageProps } from "../slots";
import { useLevel } from "../SettingsFrame";
import { useSchemaHints } from "../useRow";
import { classicSlot } from "./classic-host";

const CARD = "Town lookup";
const CITY = "plugins.entries.geolocation.config";

export const TOWN_ROWS: Row[] = [
  { id: "privacy.town-lookup.look-up-your-town-from-a-local-list", page: "privacy", card: CARD, label: "Look up your town from a local list",
    help: "On by default. Off stops looking up a town from the list on this computer.", level: 0, ownerLevel: true, control: "toggle",
    fallback: true, source: { kind: "config", path: "plugins.entries.geolocation.enabled" } },
  { id: "privacy.town-lookup.where-the-town-lookup-list-comes-from", page: "privacy", card: CARD, label: "Where the town lookup list comes from",
    help: "Leave this empty to use the usual monthly list.", level: 2, ownerLevel: true, control: "text",
    fallback: "https://download.db-ip.com/free/dbip-city-lite-{yyyy}-{mm}.mmdb.gz", source: { kind: "config", path: `${CITY}.databaseUrl` } },
  { id: "privacy.town-lookup.the-credit-line-for-the-town-list", page: "privacy", card: CARD, label: "The credit line for the town list",
    help: "The line shown next to a town. Change it only when the list comes from somewhere else.", level: 2, ownerLevel: true, control: "text",
    fallback: "IP Geolocation by DB-IP", source: { kind: "config", path: `${CITY}.attributionText` } },
  { id: "privacy.town-lookup.the-page-for-that-credit", page: "privacy", card: CARD, label: "The page for that credit",
    help: "The page that line opens.", level: 2, ownerLevel: true, control: "text",
    fallback: "https://db-ip.com", source: { kind: "config", path: `${CITY}.attributionUrl` } },
  { id: "privacy.town-lookup.how-often-to-refresh-the-town-list", page: "privacy", card: CARD, label: "How often to refresh the town list",
    help: "How many days the saved town list is kept before a new copy is downloaded.", level: 2, ownerLevel: true, control: "number", unit: "days",
    fallback: 30, source: { kind: "config", path: `${CITY}.refreshDays` } },
  { id: "privacy.town-lookup.add-my-location-to-messages", page: "privacy", card: CARD, label: "Add my location to messages",
    help: "Your town, so “near me” works. Off until you choose: it shares where you are.", level: 2, control: "toggle",
    source: { kind: "coming", need: "a location switch", reason: "Add my location to messages comes in a later update." } },
];

function TownLookup({ engine }: { engine: WindowEngine }) {
  const [level] = useLevel(engine);
  const { hints } = useSchemaHints(engine);
  const rows = cardRows("privacy", CARD, level, hints, TOWN_ROWS);
  if (!rows.length) return null;
  return (
    <section className="r1s-sec g-clear" aria-label={CARD}>
      <h2 className="g-label">{CARD}</h2>
      {rows.map((row) => <RowView key={row.id} engine={engine} row={row} />)}
    </section>
  );
}

const classic = classicSlot("privacy", "usage");
const ClassicPrivacy = classic.component!;

function PrivacyPage(props: SlotPageProps): ReactNode {
  return <>
    <ClassicPrivacy {...props} />
    <TownLookup engine={props.engine} />
  </>;
}

export const privacySlot: PageSlot = { ...classic, component: PrivacyPage, rows: [...(classic.rows ?? []), ...TOWN_ROWS] };
