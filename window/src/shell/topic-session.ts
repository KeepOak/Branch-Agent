import type { Topic } from "@branch/gateway-protocol";

/** Persist a preview thread action on the underlying engine session. */
export async function patchTopicSession(
  request: (method: string, params: unknown) => Promise<unknown>,
  topic: Topic,
  sessionId: string | undefined,
  change: Record<string, unknown>,
): Promise<void> {
  await request("sessions.patch", {
    key: topic.key,
    ...(topic.key.startsWith("agent:") ? { agentId: topic.key.split(":")[1] } : {}),
    ...(sessionId ? { expectedSessionId: sessionId } : {}),
    ...change,
  });
}
