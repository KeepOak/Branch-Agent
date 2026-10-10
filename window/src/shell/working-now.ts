/** The one rule for "working now", used by Control tower and Inbox History's Pulse.
 *  Background helper jobs (heartbeat polls, spawned helpers) are not conversations a person is waiting on. */
export type WorkingCandidate = { working: boolean; archived?: boolean; helper?: boolean; system?: boolean };

export function isWorkingNow(row: WorkingCandidate): boolean {
  return row.working && !row.archived && !row.helper && !row.system;
}
