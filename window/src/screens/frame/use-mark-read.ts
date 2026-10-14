// Opening a conversation clears its unread flag, once per unread episode (DESIGN-SPEC §4.1.1 Interactions). This re-hosts
// the Classic window's read-on-open (shell/WindowShell.tsx useMarkRead) with the same guard, connect/unread-guard.ts
// (SessionUnreadPatchGuard): fresh activity while the conversation stays open acknowledges again without patch loops, and a
// person's own "Mark unread" (markedUnreadAt) is never undone by the open conversation.
import { useEffect, useMemo } from "react";
import type { Conversation } from "../../connect/conversations";
import { SessionUnreadPatchGuard } from "../../connect/unread-guard";

type Request = (method: string, params?: unknown) => Promise<unknown>;

export function useMarkRead(request: Request, row: Conversation | null, shown: boolean, refresh: () => void) {
  const guard = useMemo(() => new SessionUnreadPatchGuard(), []);
  const key = shown && row ? row.key : "";
  const unread = row?.unread === true;
  const marker = row?.markedUnreadAt;
  const agentId = row?.agentId;
  useEffect(() => {
    if (!key) return;
    if (!guard.shouldPatch(key, unread, marker)) return;
    request("sessions.patch", { key, unread: false, ...(agentId ? { agentId } : {}), expectedMarkedUnreadAt: marker ?? null }).then(
      () => refresh(),
      (error: unknown) => guard.patchFailed(key, error),
    );
  }, [guard, key, unread, marker, agentId, request, refresh]);
}
