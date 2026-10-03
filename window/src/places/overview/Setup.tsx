// Overview › Finish setting up (preview 96 r618-setup, UI "Show “Finish setting up”" in Settings › General): five
// steps with a tick when done, until every one is. Each step's state is read from the engine: a model account
// (models.list), your phone (device.pair.list, an iOS or Android device), a chat app (channels.status, a connected
// account); "What you want help with" is the person's own pick, kept in users.prefs "ui.window.look" ("interest")
// through the window's look store; "Make it yours" is done once any look of their own is kept (a theme, accent, font
// or Appearance row). Hide turns the General row off ("checklist": false).
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { notify } from "../../shell/notify";
import { lookStore } from "../settings/set1/appearance-store";
import { useResource } from "../library/data";
import { PairDialog } from "../customize/pairing";
import { errorText } from "../settings/adapter";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

/** The interests the person can pick, with what Branch would suggest for each (the preview's five). */
export const INTERESTS: [string, string][] = [
  ["Email and messages", "Inbox Manager, and a morning sweep at 6:30"],
  ["Money and receipts", "Expense Manager, and a month-end close"],
  ["Research", "Researcher, with briefs that cite sources"],
  ["Code", "A coding Trunk on your projects folder"],
  ["Trips and plans", "Trip Planner, refundable bookings only"],
];

export type SetupFacts = { model: boolean; phone: boolean; chat: boolean; interest: boolean; madeYours: boolean };
/** Which steps are done, from the engine's answers and the person's look. */
/** Keys in the look that are not a look choice. */
const NOT_LOOK = new Set(["checklist", "interest", "pins"]);

export function setupFacts(models: unknown, devices: unknown, channels: unknown, look: Record<string, unknown>, ownPrefs = false): SetupFacts {
  const phone = arr(rec(devices).paired).some((d) => /ios|iphone|ipad|android/i.test(`${String(d.platform ?? "")} ${String(d.deviceFamily ?? "")}`));
  const accounts = rec(rec(channels).channelAccounts);
  return {
    model: arr(rec(models).models).some((m) => m.available !== false),
    phone,
    chat: Object.values(accounts).some((list) => arr(list).some((a) => a.connected === true)),
    interest: typeof look.interest === "string" && look.interest.length > 0,
    madeYours: ownPrefs || Object.keys(look).some((k) => !NOT_LOOK.has(k)),
  };
}

type Step = { key: keyof SetupFacts; label: string; run: () => void };

export function FinishSetup({ engine, openSettings }: { engine: WindowEngine; openSettings?: (page: string) => void }) {
  const store = lookStore(engine);
  const look = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap.look, () => store.snap.look);
  const models = useResource<unknown>(engine, "models.list");
  const devices = useResource<unknown>(engine, "device.pair.list");
  const channels = useResource<unknown>(engine, "channels.status", { probe: false });
  const [open, setOpen] = useState<"pair" | "interest" | null>(null);
  useEffect(() => { if (store.snap.where === "loading") void store.load(); }, [store]);
  if (look.checklist === false || models.loading || devices.loading || channels.loading) return null;
  const facts = setupFacts(models.data, devices.data, channels.data, look, Object.keys(store.snap.prefs).length > 0 || store.snap.palette !== null);
  const save = (key: string, value: unknown, done?: string) => store.set(key, value).then(() => { if (done) notify(done); }, (e: unknown) => notify(`Couldn’t save that: ${errorText(e)}`, { tone: "bad" }));
  const steps: Step[] = [
    { key: "model", label: "A model account", run: () => openSettings?.("accounts") },
    { key: "phone", label: "Your phone", run: () => setOpen("pair") },
    { key: "chat", label: "A chat app", run: () => window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: "customize", tab: "Channels" } })) },
    { key: "interest", label: "What you want help with", run: () => setOpen("interest") },
    { key: "madeYours", label: "Make it yours", run: () => openSettings?.("appearance") },
  ];
  const done = steps.filter((s) => facts[s.key]).length;
  if (done === steps.length) return null;
  return (
    <section className="ov-setup" aria-label="Finish setting up" data-testid="finish-setup">
      <div className="ov-setup-h">
        <b>Finish setting up</b>
        <small>{done} of {steps.length} done</small>
        <button type="button" className="btn ghost sm" onClick={() => void save("checklist", false, "Hidden. Settings › General brings it back.")}>Hide</button>
      </div>
      <div className="ov-setup-l">
        {steps.map((s) => (
          <button key={s.key} type="button" className="ov-step" aria-pressed={facts[s.key]} onClick={s.run}>
            <span aria-hidden="true">{facts[s.key] ? "✓" : "○"}</span>{s.label}
          </button>
        ))}
      </div>
      {open === "pair" ? <PairDialog engine={engine} close={() => { setOpen(null); devices.reload(); }} /> : null}
      {open === "interest" ? (
        <Dialog title="What do you want help with?" onClose={() => setOpen(null)} footer={<button type="button" className="btn" onClick={() => setOpen(null)}>Close</button>}>
          <p className="hint">Pick one. Branch suggests a first Trunk or routine for it; nothing is made until you say so.</p>
          <div className="ov-picks">
            {INTERESTS.map(([t, sub]) => (
              <button key={t} type="button" className="ov-pick" aria-pressed={look.interest === t} onClick={() => { setOpen(null); void save("interest", t, `Noted: ${t.toLowerCase()}.`); }}>
                <b>{t}</b><small>{sub}</small>
              </button>
            ))}
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
