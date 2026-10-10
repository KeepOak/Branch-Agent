// What the row menu, hover buttons and keys do to a conversation (DESIGN-SPEC §4.1.6 and its Parity adds),
// each through the engine method its row names, followed by a read-back of the list.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { LIST_PARAMS, type Conversation, type ConversationList } from "../connect/conversations";
import { isPreparationPending, ownerErrorText, PreparationRetry, preparationTimeoutLabel } from "../connect/preparation-status";
import { markThreadsRead } from "./contacts-model";
import { notify } from "./notify";
import { forgetDeletedConversationWindow } from "./own-window";

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export type Actions = ReturnType<typeof conversationActions>;

const reason = (error: unknown) => ownerErrorText(error);
const nameOf = (row: Conversation) => row.title || "New conversation";
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function unusedCopyLabel(request: Request, list: ConversationList, name: string): Promise<string> {
  const taken = new Set<string>();
  const add = (label: string) => {
    if (label) taken.add(label);
  };
  if (typeof list.getSnapshot === "function") {
    for (const row of list.getSnapshot().rows) {
      add(row.title);
      if (row.label) add(row.label);
    }
  }
  try {
    const listed = rec(await request("sessions.list", LIST_PARAMS));
    for (const session of Array.isArray(listed.sessions) ? listed.sessions : []) {
      const row = rec(session);
      add(str(row.label) || str(row.displayName) || str(row.derivedTitle));
    }
  } catch {
    // Fall through and try the default name; a clash still surfaces as a patch error.
  }
  const base = `${name} (copy)`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const label = `${name} (copy ${n})`;
    if (!taken.has(label)) return label;
  }
  return `${name} (copy ${Date.now()})`;
}

/** The snooze choices (§4.1.6 Snooze and Wake): each with its wake time, built from `now`. */
export function snoozeChoices(now: number): { label: string; until: number }[] {
  const d = new Date(now);
  const at = (days: number, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, 0, 0, 0).getTime();
  const choices = [
    { label: "In 1 hour", until: now + 3_600_000 },
    { label: "In 3 hours", until: now + 3 * 3_600_000 },
  ];
  choices.push({ label: "Tomorrow", until: at(1, 9) });
  const toMonday = ((8 - d.getDay()) % 7) || 7;
  choices.push({ label: "Next week", until: at(toMonday, 9) });
  return choices;
}

/** Compact time beside a Snooze choice (§2.10); its label already says Tomorrow or Next week. */
export function snoozeTime(until: number, label: string): string {
  const date = new Date(until);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  return label === "Next week" ? `${date.toLocaleDateString([], { weekday: "short" })} ${time}` : time;
}

/** "18:00", "tomorrow 09:00" or "Mon 09:00" (§4.1.6 Snooze: the wake time). */
export function wakeWords(until: number, now: number): string {
  const d = new Date(until);
  const hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  const today = new Date(now);
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (until < dayStart + 86_400_000) {
    return hm;
  }
  if (until < dayStart + 2 * 86_400_000) {
    return `Tomorrow · ${hm}`;
  }
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${hm}`;
}

/** Who a patch is for: key, Trunk and the transcript it expects (archive and snooze need it). */
function target(row: Conversation): Record<string, string> {
  return { key: row.key, ...(row.agentId ? { agentId: row.agentId } : {}), ...(row.sessionId ? { expectedSessionId: row.sessionId } : {}) };
}

export function conversationActions(request: Request, list: ConversationList, openKey: () => string | null) {
  const patch = async (row: Conversation, change: Record<string, unknown>) => {
    await request("sessions.patch", { ...target(row), ...change });
    await list.refresh();
  };
  return {
    async pin(row: Conversation) {
      await patch(row, row.pinned ? { pinned: false } : { pinned: true, snoozedUntil: null }).catch((e) => notify(`Couldn't change ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" }));
    },
    async archive(row: Conversation) {
      try {
        await patch(row, { archived: true, snoozedUntil: null });
        notify("Archived.", { action: { label: "Undo", run: () => void patch(row, { archived: false }) } });
      } catch (e) {
        notify(`Couldn't archive ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" });
      }
    },
    async restore(row: Conversation) {
      await patch(row, { archived: false }).catch((e) => notify(`Couldn't change ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" }));
    },
    async setUnread(row: Conversation, unread: boolean) {
      try {
        await patch(row, { unread });
        if (unread && row.key === openKey()) {
          notify("Marked unread. The dot shows once you leave this conversation.");
        } else {
          notify(`${nameOf(row)}: marked ${unread ? "unread" : "read"}.`);
        }
      } catch (e) {
        notify(`Couldn't change ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" });
      }
    },
    async snooze(row: Conversation, until: number | null) {
      try {
        await patch(row, { snoozedUntil: until });
        if (until) {
          notify(`Snoozed until ${wakeWords(until, Date.now())}.`, { action: { label: "Undo", run: () => void patch(row, { snoozedUntil: null }) } });
        }
      } catch (e) {
        notify(`Couldn't snooze ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" });
      }
    },
    async setDone(row: Conversation, done: boolean) {
      await patch(row, { done }).catch((e) => notify(`Couldn't change ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" }));
    },
    async rename(row: Conversation, label: string) {
      await patch(row, { label: label.trim() || null }).catch((e) => notify(`Couldn't rename ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" }));
    },
    async remove(row: Conversation) {
      try {
        await request("sessions.delete", { key: row.key, ...(row.agentId ? { agentId: row.agentId } : {}), deleteTranscript: true });
        await forgetDeletedConversationWindow(row.key).catch((error: unknown) => console.warn("Saved conversation window could not be removed", error));
      } catch (e) {
        notify(`Couldn't delete ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" });
      }
      await list.refresh();
    },
    async markAllRead(rows: Conversation[]) {
      const sessionKeys = rows.filter((r) => r.unread && r.key !== openKey()).map((r) => r.key);
      if (!sessionKeys.length) {
        return;
      }
      try {
        await markThreadsRead(request, sessionKeys);
        notify("All conversations marked read.");
      } catch (e) {
        notify(`Couldn't mark them read: ${reason(e)}.`, { tone: "bad" });
      }
      await list.refresh();
    },
    /** Icon and colour (sessions.patch icon / color); the gateway's refusal comes back as words for the picker. */
    async setLook(row: Conversation, change: { icon?: string | null; color?: string | null }): Promise<string | null> {
      try {
        await patch(row, change);
        return null;
      } catch (e) {
        return `Couldn't change it: ${reason(e)}.`;
      }
    },
    /** One change to several conversations at once (sessions.patchMany), for the select-several menu. */
    async patchMany(rows: Conversation[], change: Record<string, unknown>, done: string, undo?: Record<string, unknown>) {
      if (!rows.length) return;
      try {
        await request("sessions.patchMany", { targets: rows.map(target), patch: change });
        notify(done, undo ? { action: { label: "Undo", run: () => void request("sessions.patchMany", { targets: rows.map(target), patch: undo }).then(() => list.refresh()) } } : undefined);
      } catch (e) {
        notify(`Couldn't change them: ${reason(e)}.`, { tone: "bad" });
      }
      await list.refresh();
    },
    /** Delete several (sessions.delete for each, after one confirm). */
    async removeMany(rows: Conversation[]) {
      const failed: string[] = [];
      for (const row of rows) {
        try {
          await request("sessions.delete", { key: row.key, ...(row.agentId ? { agentId: row.agentId } : {}), deleteTranscript: true });
          await forgetDeletedConversationWindow(row.key).catch((error: unknown) => console.warn("Saved conversation window could not be removed", error));
        } catch { failed.push(nameOf(row)); }
      }
      notify(failed.length ? `Couldn't delete ${failed.join(", ")}.` : `Deleted ${rows.length} conversations.`, failed.length ? { tone: "bad" } : undefined);
      await list.refresh();
    },
    /** Adopt the Trunk's canonical contact so the shell can retain its durable list row. */
    async create(agentId?: string): Promise<string | null> {
      const backoff = new PreparationRetry();
      const createOnce = async (): Promise<string> => {
        const roster = (await request("agents.list", {})) as { defaultId?: unknown; mainKey?: unknown };
        const id = agentId || (typeof roster.defaultId === "string" ? roster.defaultId : "");
        if (!id) throw new Error("Create a Trunk before starting a conversation");
        const main = typeof roster.mainKey === "string" && roster.mainKey ? roster.mainKey : "main";
        const key = `agent:${id}:${main}`;
        // Reopening an existing contact must not reset its model, computer binding or active work.
        if (await list.selectContact(key, id)) return key;
        const adopted = await request<{ key?: unknown }>("sessions.create", { key, agentId: id });
        if (adopted.key !== key) throw new Error("The engine did not confirm this Trunk's contact conversation");
        await list.refresh();
        if (!await list.selectContact(key, id)) {
          throw new Error("The contact conversation is saved, but the engine has not made it available. Try opening it again");
        }
        return key;
      };
      try {
        while (true) {
          try {
            return await createOnce();
          } catch (error) {
            if (!isPreparationPending(error)) throw error;
            const delay = backoff.nextDelay();
            if (delay === null) throw new Error(preparationTimeoutLabel("This Trunk"));
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      } catch (e) {
        notify(`Couldn't start a conversation: ${reason(e)}.`, { tone: "bad" });
        return null;
      }
    },
    async copyConversation(row: Conversation, open: (key: string) => void): Promise<void> {
      try {
        const result = rec(await request("sessions.create", {
          parentSessionKey: row.key,
          fork: true,
          ...(row.working ? { forkFrom: "last-completed" } : {}),
          ...(row.agentId ? { agentId: row.agentId } : {}),
        }));
        const newKey = str(result.key) || str(result.sessionKey);
        if (!newKey) {
          notify("The engine didn't return the new conversation.", { tone: "bad" });
          return;
        }
        await request("sessions.patch", { key: newKey, label: await unusedCopyLabel(request, list, nameOf(row)) });
        await list.refresh();
        open(newKey);
        notify("Copied into a new conversation.");
      } catch (e) {
        notify(`Couldn't copy ${nameOf(row)}: ${reason(e)}.`, { tone: "bad" });
      }
    },
  };
}
