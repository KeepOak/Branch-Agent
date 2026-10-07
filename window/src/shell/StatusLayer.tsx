// Opens the right status-bar popover and carries out what its items do (DESIGN-SPEC §4.9): restart the engine,
// tidy up a conversation, install an update or remind tomorrow. Outcomes are toasted only once the engine has answered.
import { useMemo, useState, type MouseEvent } from "react";
import type { Conversation, ConversationList } from "../connect/conversations";
import type { SaplingSession } from "../connect/session";
import { readLevel } from "../places-nav/SettingsFrame";
import { Dialog } from "./Dialog";
import { notify } from "./notify";
import type { Above } from "./Popover";
import type { StatusItem } from "./StatusBar";
import { GatewayPopover, RoomPopover, RunningPopover, UsagePopover, VersionPopover } from "./StatusPopovers";
import type { Limits, UpdateInfo } from "./status-data";
import type { GatewayFacts } from "./use-status";
import { componentDesktop, stageWindowUpdate } from "../connect/desktop-component-updates";
import { useDesktopComponentStatus } from "../connect/desktop-component-updates";
import { useDesktopControls } from "../connect/desktop-controls";
import { COMPOSE_EVENT } from "../composer/Composer";
import { safeStorage, saveDraft } from "../composer/drafts";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Gateway, usage and version popovers align to the item's right edge; the rest to its left (§4.9.1 rule 6). */
export function statusAnchor(e: MouseEvent<HTMLElement>, item: StatusItem): Above {
  const r = e.currentTarget.getBoundingClientRect();
  const right = item === "gateway" || item === "usage" || item === "version";
  return { left: r.left, right: r.right, top: r.top, align: right ? "right" : "left" };
}

const REMIND_KEY = "branch.updateRemind";
const today = () => new Date().toDateString();

/** "Remind me tomorrow" (§4.9.8): quiet for the rest of today for this version, then it asks again. */
export function remindedToday(version: string): boolean {
  try {
    return localStorage.getItem(REMIND_KEY) === `${version}|${today()}`;
  } catch {
    return false; // storage blocked: the dot shows every day
  }
}

function remindTomorrow(version: string): void {
  try {
    localStorage.setItem(REMIND_KEY, `${version}|${today()}`);
  } catch {
    // storage blocked: the reminder lasts for this window only
  }
}

/** After gateway.restart.request, the toast waits for the window to see the engine go and come back (§4.9.3). */
function watchRestart(session: SaplingSession, startedAt: number): void {
  let wentAway = false;
  const off = session.subscribe(() => {
    const phase = session.getSnapshot().status.phase;
    if (phase !== "connected") {
      wentAway = true;
    } else if (wentAway) {
      off();
      notify(`Engine restarted in ${((Date.now() - startedAt) / 1000).toFixed(1)} s.`);
    }
  });
}

export type StatusContext = {
  session: SaplingSession;
  list: ConversationList;
  limits: Limits | null;
  gateway: GatewayFacts;
  update: UpdateInfo | null;
  version: string;
  computerName: string;
  openRow: Conversation | null;
  working: { key: string; title: string; line: string; runIds?: string[] }[];
  openSettings: (page: string) => void;
  openAutomations: () => void;
  openConversation: (key: string) => void;
  onWhatsNew: () => void;
  onReminded: () => void;
};

type Props = { item: StatusItem; above: Above; onClose: () => void; ctx: StatusContext };

async function restart(ctx: StatusContext): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = rec(await ctx.session.request("gateway.restart.request", { reason: "window.status-bar" }));
    if (result.status === "deferred") {
      notify("Waiting for running tasks"); // fakes-ok: DESIGN-SPEC §4.9.8 "Update countdown and hold" (main docs); the safe restart waits for running work
    }
    watchRestart(ctx.session, startedAt);
  } catch (e) {
    notify(`Couldn't restart the engine: ${message(e)}`, { tone: "bad" });
  }
}

/** Tidy up (§4.9.5): sessions.compact, or keep only the last 400 lines; the toast says what really happened. */
export async function tidy(ctx: Pick<StatusContext, "session" | "list">, row: Conversation, keepLast: boolean): Promise<void> {
  try {
    const params = { key: row.key, ...(row.agentId ? { agentId: row.agentId } : {}), ...(keepLast ? { maxLines: 400 } : {}) };
    const result = rec(await ctx.session.request("sessions.compact", params));
    if (result.compacted !== true) {
      notify("Nothing to tidy up yet."); // fakes-ok: DESIGN-SPEC §4.9.5 parity adds (main docs, newer than this branch's copy)
      return;
    }
    if (keepLast) {
      notify("Kept the last 400 lines. The rest is archived."); // fakes-ok: DESIGN-SPEC §4.9.5 parity adds (main docs)
      return;
    }
    await ctx.list.refresh();
    const after = ctx.list.getSnapshot().rows.find((r) => r.key === row.key);
    const free = after && after.contextTokens > 0 ? Math.max(0, Math.round(100 - (after.totalTokens / after.contextTokens) * 100)) : null;
    notify(free === null ? "Older parts summarised." : `Older parts summarised. ${free}% free.`);
  } catch (e) {
    notify(`Couldn't tidy up: ${message(e)}`, { tone: "bad" });
  }
}

async function install(ctx: StatusContext): Promise<void> {
  try {
    const result = rec(await stageWindowUpdate(ctx.session.engine));
    if (result.ok === false) {
      notify(`Couldn't install the update: ${String(rec(result.result).reason ?? result.reason ?? "the engine refused")}`, { tone: "bad" });
    }
  } catch (e) {
    notify(`Couldn't install the update: ${message(e)}`, { tone: "bad" });
  }
}

/** Stop each run the live sessions list reports, including runs in other Trunks. */
export async function pauseAll(ctx: Pick<StatusContext, "session" | "list" | "working">): Promise<void> {
  const entries = await Promise.all(ctx.working.map(async (row) => {
    if (row.runIds?.length) return row.runIds.map((runId) => ({ sessionKey: row.key, runId }));
    try {
      const history = rec(await ctx.session.request("chat.history", { sessionKey: row.key }));
      const runId = rec(history.inFlightRun).runId;
      return typeof runId === "string" && runId ? [{ sessionKey: row.key, runId }] : [];
    } catch { return []; }
  }));
  const runs = entries.flat();
  if (!runs.length) {
    notify("No live run could be paused.", { tone: "bad" });
    return;
  }
  const results = await Promise.allSettled(runs.map((run) => ctx.session.request("chat.abort", run)));
  void ctx.list.refresh();
  const failed = results.filter((result) => result.status === "rejected").length;
  notify(failed ? `Couldn't pause ${failed} of ${runs.length} runs.` : `Paused ${runs.length} run${runs.length === 1 ? "" : "s"}.`, failed ? { tone: "bad" } : undefined);
}

/** Fill the active Trunk's composer with the same /bg command its menu uses. */
export function prepareBackground(ctx: Pick<StatusContext, "session" | "openRow" | "openConversation">): void {
  const key = ctx.openRow?.key ?? ctx.session.getSnapshot().mainKey;
  if (!key) {
    notify("Open a Trunk before starting background work.", { tone: "bad" });
    return;
  }
  saveDraft(safeStorage(), key, "/bg ");
  window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { sessionKey: key, text: "/bg " } }));
  ctx.openConversation(key);
}

export function KeepLastDialog({ onCancel, onKeep }: { onCancel: () => void; onKeep: () => void }) {
  return (
    <Dialog
      title="Keep only the last 400 lines?"
      onClose={onCancel}
      testid="keep400"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" data-testid="keep400-yes" onClick={onKeep}>
            Keep the last 400
          </button>
        </>
      }
    >
      <p className="dlg-p">The older part of this conversation's log is archived on this computer and no longer goes with each message.</p>
    </Dialog>
  );
}

/** The open status-bar popover, and the confirm for "Keep only the last 400 lines…". */
export function StatusPopover({ item, above, onClose, ctx }: Props) {
  const desktopUpdate = useDesktopComponentStatus(ctx.session.gatewayUrl);
  const desktopControls = useDesktopControls();
  const [confirm, setConfirm] = useState<Conversation | null>(null);
  const level = readLevel();
  const request = useMemo(() => ctx.session.request.bind(ctx.session) as <T = unknown>(m: string, p?: unknown) => Promise<T>, [ctx.session]);
  const base = { above, onClose };
  const close = (run: () => void) => () => {
    onClose();
    run();
  };
  if (confirm) {
    return <KeepLastDialog onCancel={() => setConfirm(null)} onKeep={() => (setConfirm(null), onClose(), void tidy(ctx, confirm, true))} />;
  }
  if (item === "gateway") {
    return <GatewayPopover {...base} facts={ctx.gateway} level={level} onRestart={close(() => void restart(ctx))} onSettings={close(() => ctx.openSettings("gateway"))} />;
  }
  if (item === "usage") {
    return <UsagePopover {...base} limits={ctx.limits} request={request} onOpenUsage={close(() => ctx.openSettings("usage"))} />;
  }
  if (item === "room" && ctx.openRow) {
    const row = ctx.openRow;
    return <RoomPopover {...base} request={request} row={row} level={level} onTidy={(keepLast) => (keepLast ? setConfirm(row) : (onClose(), void tidy(ctx, row, false)))} />;
  }
  if (item === "running") {
    return <RunningPopover {...base} request={request} working={ctx.working} onOpen={(key) => (onClose(), ctx.openConversation(key))} onAutomations={close(ctx.openAutomations)}
      onBackground={close(() => prepareBackground(ctx))} onPauseAll={close(() => void pauseAll(ctx))} />;
  }
  if (item === "version") {
    return <VersionPopover {...base} update={ctx.update} version={ctx.version}
      desktopPending={desktopUpdate.status?.pendingVersion ?? null} autoApply={desktopControls.state?.autoApplyUpdates !== false}
      desktopInstall={Boolean(componentDesktop(ctx.session.gatewayUrl)?.componentUpdates)} computerName={ctx.computerName}
      onWhatsNew={close(ctx.onWhatsNew)} onInstall={close(() => void install(ctx))} onRemind={close(() => (remindTomorrow(ctx.update?.latest ?? ctx.version), ctx.onReminded()))} />;
  }
  return null;
}
