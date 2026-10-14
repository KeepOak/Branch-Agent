import type { SaplingSession } from "./session";

/** How long the desktop's update probe waits on the gateway's approval lists before it answers (Private #1047). */
export const APPROVAL_PROBE_MS = 1_500;
const APPROVAL_LISTS = ["exec.approval.list", "plugin.approval.list", "branch.approval.list"] as const;

function countItems(result: unknown): number {
  const items = Array.isArray(result) ? result : (result as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new Error("Approval status is unavailable");
  return items.length;
}

/**
 * The pending approvals the desktop's update probe reports. The gateway's lists answer within APPROVAL_PROBE_MS; a slow
 * or unreachable gateway answers with the approvals the window already shows, so the probe never times out on the desktop.
 */
export async function pendingApprovalsWithin(session: Pick<SaplingSession, "request">, shown: number): Promise<number> {
  const listed = Promise.all(APPROVAL_LISTS.map(method => session.request<unknown>(method, {})))
    .then(results => results.reduce((count, result) => count + countItems(result), 0))
    .catch(() => shown);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<number>(resolve => { timer = setTimeout(() => resolve(shown), APPROVAL_PROBE_MS); });
  try { return await Promise.race([listed, bound]); }
  finally { clearTimeout(timer); }
}
