// Settings › Notifications (DESIGN-SPEC §4.7.4): when Branch may interrupt you. Your defaults (what to tell you,
// the lock screen, quiet hours, which Trunks) live in your profile under notifications.web.v1 (users.prefs.get/set);
// this browser's subscription and its own choices go through push.web.*; a test goes through push.web.test.
import type { SettingsPageProps } from "../index";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Page, Pick, Sec, Seg, Status, Switch, useLevel, type Opt, type RowEntry } from "../kit";
import { DETAIL_OPTS, ThisBrowser, ThisDevice, useTestSend, useWebPush, deviceOff, type TellRow, type Trunk, type WebPush } from "./notifications-browser";
import { HOOK_EVENTS, KINDS, KindsOfNotice, LiveActivity, SortingRules, WebAddress, WorkStalls } from "./notifications-more";
import { prefsOff, quietNow, useNotifyPrefs, type NotifyPrefs, type Quiet } from "./notifications-prefs";
import "./notifications.css";

type Prefs = ReturnType<typeof useNotifyPrefs>;
type Tell = TellRow & { sub: string };

const NOT_YET = (what: string) => `Branch doesn’t send a notification when ${what} yet.`;
export const TELL: Tell[] = [
  { title: "A Trunk needs a yes", sub: "Shows on this computer and your phone.", key: "approvalRequested" },
  { title: "A Trunk asks you something", sub: "A question it can’t go on without. Off until you turn it on.", key: "agentQuestion" },
  { title: "A long task finishes", sub: "When a Trunk finishes its work.", key: "agentFinished" },
  { title: "A Trunk replies", sub: "Only while Branch isn’t in front.", off: NOT_YET("a Trunk replies") },
  { title: "Something stops working", sub: "A chat app, an automation, the connection or the sealed box.", off: NOT_YET("something stops working") },
  { title: "A Trunk sends a notification", sub: "When a Trunk decides you should know something now.", off: "Trunks can’t send you a notification of their own yet." },
  { title: "An automation fails", sub: "When a scheduled job can’t finish. Off until you turn it on.", key: "scheduledTaskFailed" },
  { title: "Someone mentions you", sub: "When someone picks you with @ in a conversation you share. Off until you turn it on.", key: "humanMentioned" },
  { title: "Play a sound", sub: "A short sound: the system’s own, or Branch’s chime (Advanced › Which sound).", off: "Sounds play from the Branch app on your computer." },
];

const HOURS = ["6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM", "12 AM", "1 AM", "5 AM", "6 AM", "7 AM", "8 AM", "9 AM"];
const toMinute = (h: string) => { const [n, ap] = h.split(" "); return ((Number(n) % 12) + (ap === "PM" ? 12 : 0)) * 60; };
export function hourLabel(minute: number): string {
  const h = Math.floor(minute / 60), m = minute % 60, h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
const hourOpts = (current: number): Opt[] => {
  const opts = HOURS.map((h) => ({ id: String(toMinute(h)), label: h }));
  return opts.some((o) => o.id === String(current)) ? opts : [{ id: String(current), label: hourLabel(current) }, ...opts];
};
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin", "Africa/Lagos", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
function zoneOpts(current: string): Opt[] {
  let local = "UTC";
  try { local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { local = "UTC"; }
  const ids = ["UTC", local, ...ZONES.filter((z) => z !== local), ...(current === "UTC" || current === local || ZONES.includes(current) ? [] : [current])];
  return [...new Set(ids)].map((z) => ({ id: z, label: z === local && z !== "UTC" ? `This computer’s (${z})` : z.replace(/_/g, " ") }));
}

export function NotificationsPage(props: SettingsPageProps) {
  const prefs = useNotifyPrefs(props.engine);
  const push = useWebPush(props.engine);
  const agents = useResource<RecordValue>(props.engine, "agents.list", {});
  const trunks: Trunk[] = list(agents.data?.agents).filter((a) => a.hidden !== true).map((a) => ({ id: String(a.id), name: visible(record(a.identity).name ?? a.name ?? a.id) }));
  const level = useLevel();
  const device = "This computer";
  return (
    <Page title={props.title} lede="When Branch may interrupt you.">
      <QuietStatus prefs={prefs} />
      <TellMe {...props} prefs={prefs} push={push} trunks={trunks} />
      <QuietSec prefs={prefs} />
      <ThisBrowser engine={props.engine} push={push} />
      <WebAddress />
      <WorkStalls />
      <LiveActivity />
      {level >= 1 ? <KindsOfNotice /> : null}
      {level >= 1 ? <ThisDevice push={push} trunks={trunks} tell={TELL} name={device} /> : null}
      <SortingRules />
    </Page>
  );
}

function QuietStatus({ prefs }: { prefs: Prefs }) {
  if (prefs.status === "loading") return <Status tone="idle" title="Reading your notification settings…" />;
  if (prefs.status !== "ok") return <Status tone="warn" title="Your notification settings can’t change here">{prefsOff(prefs)}</Status>;
  const q = prefs.prefs.quietHours;
  const title = !q.enabled ? "Quiet hours are off" : quietNow(q) ? "Quiet is on now" : `Quiet hours are ${hourLabel(q.startMinute)} to ${hourLabel(q.endMinute)}`;
  return <Status title={title}>{q.enabled ? "Approvals still wait in the Inbox; nothing pings you in that window." : "Branch may tell you at any hour."}</Status>;
}

type TellProps = SettingsPageProps & { prefs: Prefs; push: WebPush; trunks: Trunk[] };
function TellMe({ engine, prefs, push, trunks }: TellProps) {
  const level = useLevel();
  const off = prefsOff(prefs);
  const p = prefs.prefs;
  const devOff = deviceOff(push);
  const test = useTestSend(engine);
  const setCat = (key: keyof NotifyPrefs["categories"], on: boolean) => void prefs.change((cur) => ({ ...cur, categories: { ...cur.categories, [key]: on } }));
  return (
    <Sec title="Tell me when…">
      <Ctl title="Notifications on this computer" sub="Off keeps this device quiet; your other devices still get them." off={devOff}>
        <Switch checked={Boolean(push.device?.enabled)} disabled={Boolean(devOff)} label="Notifications on this computer" onChange={(v) => void push.setDevice((d) => ({ ...d, enabled: v }))} />
      </Ctl>
      {TELL.map((row) => (
        <Ctl key={row.title} title={row.title} sub={row.sub} off={row.key ? off : row.off}>
          <Switch checked={row.key ? p.categories[row.key] : false} disabled={Boolean(row.key ? off : row.off)} label={row.title} onChange={(v) => row.key && setCat(row.key, v)} />
        </Ctl>
      ))}
      {level >= 1 ? <TellMore prefs={prefs} trunks={trunks} /> : null}
      <Ctl title="Send a test notification" sub={test.text ?? ""}>
        <Btn sm disabled={test.busy} onClick={() => void test.send()}>Send test</Btn>
      </Ctl>
    </Sec>
  );
}

/** Advanced: device requests, which Trunks, the lock screen, which sound, recent notifications. */
function TellMore({ prefs, trunks }: { prefs: Prefs; trunks: Trunk[] }) {
  const off = prefsOff(prefs);
  const ids = prefs.prefs.agentIds;
  const pick = (id: string) => void prefs.change((cur) => {
    if (id === "*") return { ...cur, agentIds: [] };
    const next = cur.agentIds.includes(id) ? cur.agentIds.filter((x) => x !== id) : [...cur.agentIds, id];
    return { ...cur, agentIds: next };
  });
  return (
    <>
      <Ctl title="A device asks to connect: open a window to answer" sub="Off: the request waits in the Inbox and in a notification." off="Opening a window is up to the Branch app on your computer.">
        <Switch checked={false} disabled label="A device asks to connect: open a window to answer" onChange={() => undefined} />
      </Ctl>
      <Ctl title="Only these Trunks" sub="Notifications from other Trunks still reach the Inbox." off={off}>
        <span className="nt-chips">
          {[{ id: "*", name: "Every Trunk" }, ...trunks].map((t) => (
            <button key={t.id} type="button" className="chip6" disabled={Boolean(off)} aria-pressed={t.id === "*" ? ids.length === 0 : ids.includes(t.id)} onClick={() => pick(t.id)}>{t.name}</button>
          ))}
        </span>
      </Ctl>
      <Ctl title="On a locked screen" sub="Message text, commands and output never go in a notification." keep="everywhere" off={off}>
        <Seg label="On a locked screen" value={prefs.prefs.detailLevel} options={DETAIL_OPTS} disabled={Boolean(off)} onChange={(v) => void prefs.change((cur) => ({ ...cur, detailLevel: v as NotifyPrefs["detailLevel"] }))} />
      </Ctl>
      <Ctl title="Which sound" sub="The system’s sound is your computer’s own notification sound." keep="everywhere" off="Sounds play from the Branch app on your computer.">
        <Seg label="Which sound" value="" disabled options={[{ id: "system", label: "The system’s sound" }, { id: "chime", label: "Branch’s chime" }]} onChange={() => undefined} />
      </Ctl>
      <Ctl title="Recent notifications" sub="Keep the last 100 notices shown on this device." help="The last 100 Branch showed on this device, after they leave the screen." off="Branch doesn’t keep the notifications it showed yet.">
        <Btn sm disabled>Show</Btn>
      </Ctl>
    </>
  );
}

function QuietSec({ prefs }: { prefs: Prefs }) {
  const off = prefsOff(prefs);
  const q = prefs.prefs.quietHours;
  const setQ = (patch: Partial<Quiet>) => void prefs.change((cur) => ({ ...cur, quietHours: { ...cur.quietHours, ...patch } }));
  return (
    <Sec title="Quiet">
      <Ctl title="Quiet hours" sub="Approvals still wait in the Inbox; nothing pings you in these hours." off={off}>
        <span className="nt-quiet">
          <label className="nt-tsel"><span>From</span><Pick label="Quiet hours from" value={String(q.startMinute)} options={hourOpts(q.startMinute)} disabled={Boolean(off) || !q.enabled} onChange={(v) => setQ({ startMinute: Number(v) })} /></label>
          <label className="nt-tsel"><span>To</span><Pick label="Quiet hours to" value={String(q.endMinute)} options={hourOpts(q.endMinute)} disabled={Boolean(off) || !q.enabled} onChange={(v) => setQ({ endMinute: Number(v) })} /></label>
          <Switch checked={q.enabled} disabled={Boolean(off)} label="Quiet hours" onChange={(v) => setQ({ enabled: v })} />
        </span>
      </Ctl>
      {q.enabled ? (
        <Ctl title="Time zone" sub="So quiet hours hold when your phone is in another time zone." off={off}>
          <Pick label="Time zone" value={q.timeZone} options={zoneOpts(q.timeZone)} disabled={Boolean(off)} onChange={(v) => setQ({ timeZone: v })} />
        </Ctl>
      ) : null}
      <Ctl title="Days off" sub="No notifications at all on these days." keep="everywhere" off="Branch has no days off yet; quiet hours cover each day the same.">
        <Seg label="Days off" value="None" disabled options={[{ id: "Sat", label: "Sat" }, { id: "Sun", label: "Sun" }, { id: "None", label: "None" }]} onChange={() => undefined} />
      </Ctl>
    </Sec>
  );
}

const rows = (sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "notifications", title, sec, group: sec.replace(/, (more|technical|in depth)$/, ""), lv }));
const TELL_TITLES = TELL.map((t) => t.title);
export const NOTIFICATIONS_ROWS: RowEntry[] = [
  ...rows("Tell me when…", 0, ["Notifications on this computer", ...TELL_TITLES, "Send a test notification"]),
  ...rows("Tell me when…", 1, ["A device asks to connect: open a window to answer", "Only these Trunks", "On a locked screen", "Which sound", "Recent notifications"]),
  ...rows("Quiet", 0, ["Quiet hours", "Time zone", "Days off"]),
  ...rows("Send events to a web address", 0, ["Address", "Events"]).map((r) => (r.title === "Events" ? { ...r, words: HOOK_EVENTS.join(" ") } : r)),
  ...rows("When work stalls", 0, ["A conversation stopped moving"]),
  ...rows("Live activity", 0, ["Live activity at the top of the screen (Mac)"]),
  ...rows("Kinds of notice", 1, KINDS),
  ...rows("This computer", 1, ["Name on its notifications", "On a locked screen", "Quiet hours", "Only these Trunks", ...TELL_TITLES]),
  ...rows("Sorting notifications", 2, ["Use the kind a Trunk gives", "Add a rule"]),
];
