// People's "Live now" counts the same rows as the Right now panel: same query (LIST_PARAMS), same projection
// (projectConversation) and the same working rule (isWorkingNow, shell/working-now.ts).
import { LIST_PARAMS, projectConversation } from "../../connect/conversations";
import { isWorkingNow } from "../../shell/working-now";
import { rec, recs, rows, type Row } from "./data";

/** The sessions.list params both Right now and People's Live now read. */
export const RUNS_PARAMS = LIST_PARAMS;

/** The People rows for conversations the Right now panel counts as working. */
export function workingRows(value: unknown): Row[] {
  const working = new Set(recs(rec(value).sessions).map((r) => projectConversation(r, null)).filter(isWorkingNow).map((c) => c.key));
  return rows(value).filter((r) => working.has(r.key));
}
