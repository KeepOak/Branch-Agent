// Settings › Automations: the controls the R1 page draws itself (slots.ts controls), each reusing Classic Advanced's logic
// on the same keys (places/settings/set2/advanced.tsx AlertsTo, EditRow and the list rows): where failure alerts go (a chat
// app or a web address, cron.failureAlert), the private addresses web addresses may reach, and the Edit windows for chat
// commands, hooks, which Trunk answers and schedules.
import { text } from "../../../places/settings/adapter";
import type { PageSlot, SlotControlProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";
import { editSection, listControl, useConfigSnap } from "./customize-live";

const FA = "cron.failureAlert";

/** Send alerts to: where each automation sends, a chat app set up in config, or a web address. */
export function AlertsTo({ engine, row }: SlotControlProps) {
  const { store, snap, get } = useConfigSnap(engine);
  const [failed, run] = useFailure();
  const mode = text(get(`${FA}.mode`)) || "announce";
  const channel = text(get(`${FA}.channel`));
  const channels = get("channels");
  const chats = Object.keys(channels && typeof channels === "object" ? channels : {}).filter((k) => !["defaults", "modelByChannel"].includes(k));
  const value = mode === "webhook" ? "webhook" : channel;
  const pick = (v: string) => void run(() => store.set(FA, v === "webhook" ? { mode: "webhook", channel: null } : v ? { mode: "announce", channel: v } : { channel: null }));
  const options = [{ v: "", label: "Where each automation sends" }, ...chats.map((id) => ({ v: id, label: id.charAt(0).toUpperCase() + id.slice(1) })), { v: "webhook", label: "A web address" }];
  const label = row.label ?? "Send alerts to";
  return <>
    <Needs engine={engine} need={["config.patch"]} where={label}>
      <select className="r1s-inp" aria-label={label} value={value} disabled={!snap} onChange={(e) => pick(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** The Automations page's own controls (plugged.ts). */
export const AUTOS_PAGE: PageSlot = {
  controls: {
    "autos.autos.alert-to": AlertsTo,
    "autos.autos.private-hosts": listControl("cron.webhookSsrfPolicy.allowedHostnames", "192.168.1.20"),
    "autos.autos.commands": editSection("commands", "Chat commands"),
    "autos.autos.hooks": editSection("hooks", "Hooks"),
    "autos.autos.bindings": editSection("bindings", "Which Trunk answers"),
    "autos.autos.schedules": editSection("cron", "Schedules"),
  },
};
