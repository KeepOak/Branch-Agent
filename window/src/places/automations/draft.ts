// The proposal card's state and the exact cron.add / cron.update params it sends. Field names and limits are
// the engine's (gateway-protocol schema/cron.ts: CronAddParams, CronJobPatch); an edit patches only what changed,
// so delivery, failure alerts and command/script payloads the person didn't touch are kept.
import { emptyForm, formToSchedule, guessFromWords, scheduleToForm, type ScheduleForm } from "./model";
import { rec, str, type Row } from "./runtime";

export type SendsTo = "keep" | "conversation" | "chats" | "nowhere" | "webhook";

/** Announce delivery that names a chat-app account or a specific app (not “last”). */
export function isChatDelivery(delivery: Row): boolean {
  if (str(delivery.mode) !== "announce") return false;
  if (str(delivery.accountId)) return true;
  const channel = str(delivery.channel);
  return Boolean(channel && channel !== "last");
}
export type Draft = {
  mode: "new" | "edit" | "copy";
  id?: string; revision?: string; original?: Row;
  name: string; note: string; message: string;
  how: "task" | "note"; wake: "now" | "next-heartbeat";
  form: ScheduleForm; agentId: string; model: string; thinking: string;
  sendsTo: SendsTo; webhook: string; recipient: string; account: string; bestEffort: boolean;
  clearAgent: boolean; sessionKey: string; lightContext: boolean; timeout: string;
  enabled: boolean; deleteAfterRun: boolean;
  /** "agentTurn" / "systemEvent" are made here; "command" / "script" were made elsewhere and stay as they are. */
  payloadKind: string;
};

const blank = (agentId: string): Omit<Draft, "mode" | "name" | "message" | "form"> => ({
  note: "", how: "task", wake: "now", agentId, model: "", thinking: "", sendsTo: "conversation", webhook: "", recipient: "", account: "",
  bestEffort: false, clearAgent: false, sessionKey: "", lightContext: false, timeout: "", enabled: true, deleteAfterRun: false, payloadKind: "agentTurn",
});

/** A new card from your words (Branch's guess fills only fields you can see and change). */
export function draftFromWords(words: string, agentId: string, now = Date.now()): Draft {
  const { task, form } = guessFromWords(words, now);
  const name = task.length > 48 ? `${task.slice(0, 47).trimEnd()}…` : task;
  return { ...blank(agentId), mode: "new", name, message: task, form };
}

export function draftFromIdea(title: string, message: string, agentId: string): Draft {
  return { ...blank(agentId), mode: "new", name: title, message, form: emptyForm() };
}

/** The card filled from a saved automation: "edit" for Change…, "copy" for Duplicate. */
export function draftFromJob(job: Row, mode: "edit" | "copy", name = str(job.name)): Draft {
  const payload = rec(job.payload), delivery = rec(job.delivery), kind = str(payload.kind);
  const madeHere = kind === "agentTurn" || kind === "systemEvent";
  return {
    ...blank(str(job.agentId)), mode, name,
    ...(mode === "edit" ? { id: str(job.id), revision: str(job.configRevision), original: job } : {}),
    note: str(job.description),
    message: madeHere ? str(payload.message) || str(payload.text) : "",
    how: kind === "systemEvent" ? "note" : "task",
    wake: job.wakeMode === "next-heartbeat" ? "next-heartbeat" : "now",
    form: scheduleToForm(rec(job.schedule)),
    model: str(payload.model), thinking: str(payload.thinking),
    timeout: typeof payload.timeoutSeconds === "number" ? String(payload.timeoutSeconds) : "",
    lightContext: payload.lightContext === true,
    sendsTo: isChatDelivery(delivery) ? "chats" : mode === "edit" ? "keep" : delivery.mode === "none" ? "nowhere" : delivery.mode === "webhook" ? "webhook" : "conversation",
    webhook: delivery.mode === "webhook" ? str(delivery.to) : "",
    recipient: delivery.mode === "announce" ? str(delivery.to) : "",
    account: str(delivery.accountId), bestEffort: delivery.bestEffort === true,
    sessionKey: str(job.sessionKey),
    enabled: mode === "copy" ? true : job.enabled !== false, deleteAfterRun: job.deleteAfterRun === true,
    // A copy of a command or script automation starts with "It does" empty, as an ordinary task.
    payloadKind: madeHere || mode === "copy" ? (kind === "systemEvent" ? "systemEvent" : "agentTurn") : kind,
  };
}

function checkWebhook(url: string): void {
  if (!url.trim()) throw new Error("Add a web address.");
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { throw new Error("Use an http:// or https:// address without a name or password in it."); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error("Use an http:// or https:// address without a name or password in it.");
}

export function deliveryFor(d: Draft): Row | undefined {
  if (d.sendsTo === "keep") return undefined;
  const shared = { ...(d.bestEffort ? { bestEffort: true } : {}), ...(d.account.trim() ? { accountId: d.account.trim() } : {}) };
  if (d.sendsTo === "nowhere") return { mode: "none" };
  if (d.sendsTo === "webhook") { checkWebhook(d.webhook); return { mode: "webhook", to: d.webhook.trim(), ...shared }; }
  return { mode: "announce", ...(d.recipient.trim() ? { to: d.recipient.trim() } : {}), ...shared };
}

function timeoutSeconds(d: Draft): number | undefined {
  if (!d.timeout.trim()) return undefined;
  const n = Number(d.timeout);
  if (!Number.isFinite(n) || n < 0) throw new Error("Use 0 or more.");
  return n;
}

function payloadFor(d: Draft): Row {
  if (d.how === "note") return { kind: "systemEvent", text: d.message.trim() };
  const t = timeoutSeconds(d);
  return { kind: "agentTurn", message: d.message.trim(), ...(d.model.trim() ? { model: d.model.trim() } : {}), ...(d.thinking ? { thinking: d.thinking } : {}), ...(t === undefined ? {} : { timeoutSeconds: t }), ...(d.lightContext ? { lightContext: true } : {}) };
}

function check(d: Draft): void {
  if (!d.name.trim()) throw new Error("Give it a name.");
  if ((d.payloadKind === "agentTurn" || d.payloadKind === "systemEvent") && !d.message.trim()) throw new Error("Say what it does.");
}

/** cron.add params for a new card or a duplicate. */
export function addParams(d: Draft, now = Date.now()): Row {
  check(d);
  const delivery = deliveryFor(d);
  return {
    name: d.name.trim(), ...(d.note.trim() ? { description: d.note.trim() } : {}),
    schedule: formToSchedule(d.form, now),
    sessionTarget: d.how === "note" ? "main" : "isolated", wakeMode: d.how === "note" ? d.wake : "now",
    payload: payloadFor(d),
    ...(delivery && d.how === "task" ? { delivery } : {}),
    ...(d.clearAgent ? {} : d.agentId ? { agentId: d.agentId } : {}),
    ...(d.sessionKey.trim() ? { sessionKey: d.sessionKey.trim() } : {}),
    enabled: d.enabled,
    ...(d.form.repeat === "once" && d.deleteAfterRun ? { deleteAfterRun: true } : {}),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** cron.update params with only the fields this card changed. */
export function updateParams(d: Draft, now = Date.now()): Row {
  check(d);
  const job = d.original ?? {}, patch: Row = {};
  if (d.name.trim() !== str(job.name)) patch.name = d.name.trim();
  if (d.note.trim() !== str(job.description)) patch.description = d.note.trim();
  const before = scheduleToForm(rec(job.schedule));
  if (!same(before, d.form)) patch.schedule = formToSchedule(d.form, now);
  const nextAgent = d.clearAgent ? null : d.agentId || null;
  if ((nextAgent ?? "") !== str(job.agentId)) patch.agentId = nextAgent;
  if (d.payloadKind === "agentTurn" || d.payloadKind === "systemEvent") {
    const payload = payloadFor(d), old = rec(job.payload);
    const changed = Object.keys(payload).some(k => !same(payload[k], old[k])) || (old.kind === "agentTurn" && d.how === "task" && ((old.model && !d.model.trim()) || (old.timeoutSeconds !== undefined && !d.timeout.trim())));
    if (changed) {
      patch.payload = d.how === "task" && old.kind === "agentTurn" ? { ...payload, ...(old.model && !d.model.trim() ? { model: null } : {}), ...(old.timeoutSeconds !== undefined && !d.timeout.trim() ? { timeoutSeconds: null } : {}) } : payload;
      const target = d.how === "note" ? "main" : "isolated";
      if (target !== str(job.sessionTarget)) patch.sessionTarget = target;
    }
    if (d.how === "note" && d.wake !== str(job.wakeMode)) patch.wakeMode = d.wake;
  }
  const delivery = deliveryFor(d);
  if (delivery && !same(delivery, job.delivery)) patch.delivery = delivery;
  if (d.sessionKey.trim() !== str(job.sessionKey)) patch.sessionKey = d.sessionKey.trim() || null;
  if (d.form.repeat === "once" && d.deleteAfterRun !== (job.deleteAfterRun === true)) patch.deleteAfterRun = d.deleteAfterRun;
  return { id: d.id, ...(d.revision ? { expectedConfigRevision: d.revision } : {}), patch };
}

/** The "Change where it sends…" patch on its own. */
export function sendsToParams(job: Row, d: Draft): Row {
  const delivery = deliveryFor(d);
  return { id: str(job.id), ...(job.configRevision ? { expectedConfigRevision: job.configRevision } : {}), patch: { delivery } };
}

export type FailurePolicy = { use: "usual" | "off" | "own"; after: string; cooldown: string; how: "announce" | "webhook"; to: string };
export function failurePolicy(job: Row): FailurePolicy {
  const fa = job.failureAlert;
  if (fa === false) return { use: "off", after: "2", cooldown: "60", how: "announce", to: "" };
  const r = rec(fa);
  if (!fa) return { use: "usual", after: "2", cooldown: "60", how: "announce", to: "" };
  return { use: "own", after: String(r.after ?? 2), cooldown: String(typeof r.cooldownMs === "number" ? r.cooldownMs / 60_000 : 60), how: r.mode === "webhook" ? "webhook" : "announce", to: str(r.to) };
}

/** The "When it fails…" cron.update params (failureAlert: null = the usual setting, false = don't alert). */
export function failureParams(job: Row, p: FailurePolicy): Row {
  let failureAlert: unknown = null;
  if (p.use === "off") failureAlert = false;
  if (p.use === "own") {
    const after = Number(p.after), cooldown = Number(p.cooldown);
    if (!Number.isInteger(after) || after < 1) throw new Error("Use a whole number above 0.");
    if (!Number.isFinite(cooldown) || cooldown < 0) throw new Error("Use 0 or more.");
    if (p.how === "webhook") checkWebhook(p.to);
    failureAlert = { after, cooldownMs: Math.round(cooldown * 60_000), mode: p.how, ...(p.to.trim() ? { to: p.to.trim() } : {})};
  }
  return { id: str(job.id), ...(job.configRevision ? { expectedConfigRevision: job.configRevision } : {}), patch: { failureAlert } };
}

/** True when a Change… card differs from the saved automation it was opened from. */
export function editChanged(d: Draft): boolean {
  if (d.mode !== "edit" || !d.original) return false;
  return JSON.stringify({ ...d, original: undefined }) !== JSON.stringify({ ...draftFromJob(d.original, "edit"), original: undefined });
}
