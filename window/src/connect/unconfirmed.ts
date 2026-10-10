// Messages sent but not confirmed ("Not confirmed yet"): the connection went after the send left and before the
// engine answered, so the engine may or may not have it. Each is kept in its conversation's waiting line (so a reload
// keeps it), stamped with the engine it went to, and settled only by a read of that conversation on that engine:
// - the read holds it (its message or steer, a waiting input, an input receipt, the running turn): it goes;
// - the read reaches back past it (to the newest entry the conversation had when it was sent, or to the start of a
//   conversation that had none) and doesn't hold it: it is sent once more under the same id;
// - its conversation is gone, the read can't reach back far enough, or the engine refuses the read for good: Not sent.
// Nothing is ever sent again without that proof: the engine's dedupe lasts minutes and isn't kept across engines.
import { historyToBlocks } from "../thread/history";
import type { Block } from "../thread/model";
import { addChecking, itemsEverywhere, mark, remove, updateLine, type QueueItem, type SentTo } from "../composer/queue";
import { safeStorage } from "../composer/drafts";
import type { SendExtras } from "./engine";
import { failedAck, firmRefusal } from "./send-errors";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The engine's receipts answer at most this many run ids per read (CHAT_INPUT_RECEIPT_MAX_RUN_IDS). */
const MAX_RECEIPT_IDS = 50;
/** A small first page settles the usual case; older pages are read only to reach back past a message. */
const FIRST_PAGE = 50;
const PAGE = 200;
const MAX_PAGES = 8;
/** How soon a lost send is checked, then how long between checks while any stay unconfirmed. */
export const LOST_CHECK_MS = 2_000;
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];

const UNKNOWN = "Branch couldn't tell whether it arrived. Check the conversation before sending it again.";
const GONE = "Its conversation was deleted.";

/** This window, for the records it sends: only it keeps their files. */
export const WINDOW_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
const lockName = (owner: string) => `branch.window.${owner}`;
try {
  // Held for this window's life, so another window can tell whether the sender of a record is still open.
  void navigator.locks?.request(lockName(WINDOW_ID), () => new Promise<void>(() => {}));
} catch {
  // No Web Locks here: other windows treat this one as closed, and file its sends with files as Not sent.
}

/** Whether another window that sent a record is still open (this one would hold the record's files if it had them). */
async function windowOpen(owner: string): Promise<boolean> {
  if (owner === WINDOW_ID) return false;
  try {
    const state = await navigator.locks?.query();
    return Boolean(state?.held?.some((lock) => lock.name === lockName(owner)));
  } catch {
    return false;
  }
}

/** Which engine a record belongs to: its host (a P45 handoff keeps the host and changes only the port) and, when the
 *  engine says it, its state folder (two engines on one host differ there). */
export function engineKeyOf(gatewayUrl: string, hello: unknown): string {
  let host = gatewayUrl;
  let port = "";
  try {
    const url = new URL(gatewayUrl);
    host = url.hostname.toLowerCase();
    port = url.port;
  } catch {
    // Not a URL: the address itself is the key.
  }
  return `${host}${port ? `:${port}` : ""}|${str(rec(rec(hello).snapshot).stateDir)}`;
}

const addressOf = (engine: string): string => engine.slice(0, engine.indexOf("|"));
const hostOf = (engine: string): string => addressOf(engine).replace(/:\d+$/, "");
const folderOf = (engine: string): string => engine.slice(engine.indexOf("|") + 1);

/** Whether a record stamped `stamped` belongs to the engine `current`: the same host, and the same state folder when
 *  both hellos named one (the engine names it only to admin callers, so a missing one doesn't tell engines apart). */
export function sameEngine(stamped: string | undefined, current: string): boolean {
  if (!stamped || hostOf(stamped) !== hostOf(current)) return false;
  if (folderOf(stamped) && folderOf(current)) return folderOf(stamped) === folderOf(current);
  const host = hostOf(current);
  return host === "127.0.0.1" || host === "[::1]" || host === "localhost" || addressOf(stamped) === addressOf(current);
}

/** A message the engine replaced to fit the page and stripped of its key (or the "too large to display" sentinel):
 *  it could be the one being looked for, so the page can't prove that message missing. */
function opaque(message: unknown): boolean {
  const m = rec(message);
  const branch = rec(m.__branch);
  const text = list(m.content).map((part) => str(rec(part).text)).join("");
  if (text.startsWith("[chat.history unavailable:")) return true;
  return m.role === "user" && branch.truncated === true && !str(m.idempotencyKey) && !str(branch.idempotencyKey);
}

/** How a card says its attachments weren't kept (the waiting line holds words only). */
export function droppedFiles(attachments: number): string {
  if (!attachments) return "";
  return ` ${attachments === 1 ? "Its attachment wasn't" : `Its ${attachments} attachments weren't`} kept; add ${attachments === 1 ? "it" : "them"} again.`;
}

/** Every run whose input a read shows the engine holds: your message in the history ("<runId>:user", a steer too), a
 *  waiting input, one it took (a receipt, waiting or consumed; a cancelled one is never replayed, so it counts), or
 *  the running turn. */
export function heldRuns(history: readonly Block[], pendingInputs: unknown, inFlightId: string, receipts?: unknown): Set<string> {
  const held = new Set<string>();
  for (const b of history) if ((b.kind === "user" || b.kind === "steer") && b.meta?.runKey) held.add(b.meta.runKey);
  for (const item of list(rec(pendingInputs).items)) held.add(str(rec(item).runId));
  for (const receipt of list(receipts)) held.add(str(rec(receipt).runId));
  held.add(inFlightId);
  held.delete("");
  return held;
}

type Verdict = "held" | "lacks" | "gone" | "unknown";

/** What the window does around a re-send of a message in the open conversation (draw it, then settle the drawing). */
export type ResendView = { before(sessionKey: string, item: QueueItem): () => void; after(sessionKey: string): void };

type Host = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  /** The engine this window is connected to now, or null while it isn't. */
  engine(): string | null;
  view: ResendView;
  notice(text: string): void;
};

/** In-memory echo of the first message of a conversation: drawn until history holds it. Not a lost send,
 *  so it is never checked or sent again (the engine's dedupe is minutes-only). */
export class FirstSendEcho {
  private echo: { sessionKey: string; text: string; runId: string } | null = null;

  set(sessionKey: string, text: string, runId: string): void {
    this.echo = { sessionKey, text, runId };
  }

  peek(sessionKey: string): { text: string; runId: string } | null {
    return this.echo?.sessionKey === sessionKey ? { text: this.echo.text, runId: this.echo.runId } : null;
  }

  clear(runId?: string): void {
    if (!this.echo || (runId && this.echo.runId !== runId)) return;
    this.echo = null;
  }
}

export class UnconfirmedSends {
  private readonly files = new Map<string, unknown[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private attempt = 0;
  /** The engine refused reads with receipts once (an older store): later reads go without. */
  private receiptsRefused = false;
  private stopped = false;
  private readonly host: Host;

  constructor(host: Host) {
    this.host = host;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** A send whose connection went before the engine answered: kept as "Not confirmed yet" and checked soon. */
  lost(sessionKey: string, id: string, text: string, extras: SendExtras, sentTo: Omit<SentTo, "owner">): void {
    const { attachments, ...sentWith } = extras;
    if (attachments?.length) this.files.set(id, attachments);
    try {
      const counted = { ...sentWith, ...(attachments?.length ? { attachments: attachments.length } : {}) };
      addChecking(safeStorage(), sessionKey, { id, text, sentWith: counted, sentTo: { ...sentTo, owner: WINDOW_ID } });
    } catch (stored) {
      this.host.notice(`${text.slice(0, 40)}… may not have been sent, and this computer couldn't keep it: ${stored instanceof Error ? stored.message : String(stored)}`);
      return;
    }
    this.attempt = 0;
    this.schedule(LOST_CHECK_MS);
  }

  /** Connected to `engine`: records for any other engine become Not sent (a switch to another computer), then this
   *  engine's are checked. */
  connected(engine: string): void {
    const foreign = this.records().filter(({ item }) => !sameEngine(item.sentTo?.engine, engine));
    for (const { sessionKey, item } of foreign) this.settle(sessionKey, item.id, `Sent to ${item.sentTo ? hostOf(item.sentTo.engine) : "another computer"} before you switched computers. It may have arrived there.`);
    if (foreign.length) {
      const hosts = [...new Set(foreign.map(({ item }) => (item.sentTo ? hostOf(item.sentTo.engine) : "another computer")))].join(", ");
      this.host.notice(`${foreign.length === 1 ? "A message" : `${foreign.length} messages`} sent to ${hosts} weren't confirmed before you switched computers. ${foreign.length === 1 ? "It" : "They"} may have arrived there.`);
    }
    this.attempt = 0;
    void this.check();
  }

  /** This window's pairing with the engine at `gatewayUrl` is gone: keep their text as Not sent. */
  unpaired(gatewayUrl: string): void {
    const host = hostOf(engineKeyOf(gatewayUrl, null));
    for (const { sessionKey, item } of this.records()) if (item.sentTo && hostOf(item.sentTo.engine) === host) this.settle(sessionKey, item.id, `${host} no longer knows this computer. It may have arrived there.`);
  }

  private records(): { sessionKey: string; item: QueueItem }[] {
    try {
      return itemsEverywhere(safeStorage(), "checking");
    } catch {
      return [];
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), ms);
  }

  /** One round over this engine's records, conversation by conversation; while any stay, the next round backs off. */
  async check(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const engine = this.host.engine();
    if (this.running || this.stopped || !engine) return;
    this.running = true;
    try {
      const bySession = new Map<string, QueueItem[]>();
      for (const { sessionKey, item } of this.records()) {
        if (sameEngine(item.sentTo?.engine, engine)) bySession.set(sessionKey, [...(bySession.get(sessionKey) ?? []), item]);
      }
      for (const [sessionKey, items] of bySession) await this.checkConversation(sessionKey, items.slice(0, MAX_RECEIPT_IDS));
    } finally {
      this.running = false;
      if (this.records().some(({ item }) => sameEngine(item.sentTo?.engine, engine))) {
        this.schedule(BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!);
        this.attempt += 1;
      }
    }
  }

  private async checkConversation(sessionKey: string, items: readonly QueueItem[]): Promise<void> {
    let verdicts: Map<string, Verdict>;
    try {
      verdicts = await this.verdicts(sessionKey, items);
    } catch (error) {
      // A read the engine refuses for good settles nothing by itself, so it stops being asked: Not sent.
      if (firmRefusal(error)) for (const item of items) this.settle(sessionKey, item.id, `Branch couldn't check whether it arrived: ${error instanceof Error ? error.message : String(error)}`);
      return; // Otherwise no read, no decision: they stay until a read works.
    }
    for (const item of items) {
      const verdict = verdicts.get(item.id) ?? "unknown";
      if (verdict === "held") this.settle(sessionKey, item.id);
      else if (verdict === "lacks") await this.resend(sessionKey, item);
      else this.settle(sessionKey, item.id, verdict === "gone" ? GONE : UNKNOWN);
    }
  }

  private read(sessionKey: string, params: Record<string, unknown>, ids?: string[]): Promise<Record<string, unknown>> {
    const ask = (withIds: boolean) => this.host.request("chat.history", { sessionKey, ...params, ...(withIds && ids ? { inputRunIds: ids } : {}) }).then(rec);
    if (!ids || this.receiptsRefused) return ask(false);
    // Receipts are a bonus: a read the engine can't answer with them (an older store) is asked again without.
    return ask(true).catch(async (error: unknown) => {
      if (!firmRefusal(error)) throw error;
      const answer = await ask(false);
      this.receiptsRefused = true;
      return answer;
    });
  }

  /** Reads the conversation from its newest page back until every item is held, or proven missing (the read reached
   *  its anchor, or the start), or the pages run out. */
  private async verdicts(sessionKey: string, items: readonly QueueItem[]): Promise<Map<string, Verdict>> {
    const verdicts = new Map<string, Verdict>();
    const held = new Set<string>();
    const seen = new Set<string>();
    let blind = false;
    let params: Record<string, unknown> = { limit: FIRST_PAGE };
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const h = await this.read(sessionKey, params, page === 0 ? items.map((item) => item.id) : undefined);
      const messages = list(h.messages);
      if (page === 0 && !str(h.sessionId) && !messages.length) {
        // No such conversation: one that existed was deleted (sending again would bring it back); one that didn't
        // was never made, so the message isn't there.
        for (const item of items) verdicts.set(item.id, item.sentTo?.existed ? "gone" : "lacks");
        return verdicts;
      }
      const first = page === 0;
      for (const id of heldRuns(historyToBlocks(messages, [], sessionKey, null), first ? h.pendingInputs : null, first ? str(rec(h.inFlightRun).runId) : "", first ? h.inputReceipts : null)) held.add(id);
      for (const m of messages) seen.add(str(rec(rec(m).__branch).id));
      blind ||= messages.some(opaque);
      // Only an engine that says there is nothing older proves the read reached the start.
      const start = h.hasMore === false;
      for (const item of items) {
        if (verdicts.has(item.id)) continue;
        if (held.has(item.id)) verdicts.set(item.id, "held");
        else if (blind) continue; // An unreadable message on the way back could be this one: never "lacks".
        else if (item.sentTo?.anchor ? seen.has(item.sentTo.anchor) : start) verdicts.set(item.id, "lacks");
      }
      if (verdicts.size === items.length || start || typeof h.nextOffset !== "number") break;
      params = { limit: PAGE, offset: h.nextOffset };
    }
    return verdicts;
  }

  /** One the engine doesn't have: sent once more under the same id, a single try (a lease refusal waits for the next
   *  check, which reads again first). Its answer is read like the first send's. */
  private async resend(sessionKey: string, item: QueueItem): Promise<void> {
    const files = this.files.get(item.id);
    const count = item.sentWith?.attachments ?? 0;
    if (count && !files) {
      // Its files are in the window that sent it: that window re-sends it while it is open. Words alone would be a
      // different message.
      if (item.sentTo && (await windowOpen(item.sentTo.owner))) return;
      this.settle(sessionKey, item.id, `The connection closed before Branch could confirm it.${droppedFiles(count)}`);
      return;
    }
    const { attachments: _count, ...sentWith } = item.sentWith ?? {};
    const undo = this.host.view.before(sessionKey, item);
    try {
      const params = { ...sentWith, ...(files ? { attachments: files } : {}), sessionKey, message: item.text, idempotencyKey: item.id };
      const failure = failedAck(rec(await this.host.request("chat.send", params)));
      if (failure) {
        undo();
        this.settle(sessionKey, item.id, failure);
        return;
      }
      // Held or started: it is the engine's now. Its turn shows when its events come.
      this.settle(sessionKey, item.id);
      this.host.view.after(sessionKey);
    } catch (error) {
      undo();
      // The engine said no for good: Not sent. Lost again, or busy for a moment (a handoff lease): checked again.
      if (firmRefusal(error)) this.settle(sessionKey, item.id, error instanceof Error ? error.message : String(error));
    }
  }

  /** A "Not confirmed yet" message settled: the engine has it (it goes), or not (`failure`: Not sent). */
  private settle(sessionKey: string, id: string, failure?: string): void {
    this.files.delete(id);
    try {
      updateLine(safeStorage(), sessionKey, (line) => (failure ? mark(line, id, "failed", failure) : remove(line, id)));
    } catch {
      // The line can't be written here; the next check settles it.
    }
  }
}
