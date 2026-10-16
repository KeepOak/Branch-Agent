// "New conversation with <Trunk>" (the + menu and a Trunk row's menu): a new, empty thread under that Trunk, the way the
// preview's newConv() adds a "New conversation" row at once (preview ACTS['new-with'] toasts "New conversation with X.").
// It is a real session (sessions.create with the Trunk's own conversation as its parent, no message, no turn), so its row
// in the Trunk's threads can be renamed, pinned, closed and deleted before anything is sent. No displayName is sent: the
// engine titles it from the first message, and until then the threads show it as "New conversation".
import { isPreparationPending, PreparationRetry, preparationTimeoutLabel } from "../../connect/preparation-status";

type Request = <T>(method: string, params?: unknown) => Promise<T>;

/** The words an untitled new thread shows until its first message names it. */
export const NEW_THREAD_TITLE = "New conversation";

/** Creates the empty thread and returns its key. `parentKey` is the Trunk's own conversation (agent:<id>:<main key>). */
export async function createEmptyThread(request: Request, agentId: string, parentKey: string, wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))): Promise<string> {
  const backoff = new PreparationRetry();
  while (true) {
    try {
      const result = await request<{ key?: unknown }>("sessions.create", { agentId, parentSessionKey: parentKey });
      if (typeof result?.key !== "string" || !result.key) throw new Error("Branch didn't make the conversation. Try again.");
      return result.key;
    } catch (error) {
      if (!isPreparationPending(error)) throw error;
      const delay = backoff.nextDelay();
      if (delay === null) throw new Error(preparationTimeoutLabel("This Trunk"));
      await wait(delay);
    }
  }
}
