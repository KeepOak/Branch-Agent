// Creating a topic from R1's "+" (owner item 5): a session under the Trunk's main conversation, named with its label so the
// engine keeps the name (labelled topics are never shortened). It starts no turn. The emoji is the rail's local choice, the same
// one "Change icon" writes; the colour is an engine colour id, sent with sessions.patch.

export type NewTopicDraft = { name: string; icon: string; colour: string | null };
type Request = (method: string, params: unknown) => Promise<unknown>;

export const TOPIC_EMOJI_KEY = "branch-topic-emoji-t5";

function rememberTopicIcon(key: string, icon: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(TOPIC_EMOJI_KEY) || "{}") as Record<string, string>;
    localStorage.setItem(TOPIC_EMOJI_KEY, JSON.stringify({ ...stored, [key]: icon }));
  } catch { /* Storage blocked: the rail falls back to its suggested emoji. */ }
}

/** Creates the topic and returns its session key. The Trunk's main key is the parent, so the engine lists it as a topic of that Trunk. */
export async function createTopicSession(request: Request, target: { agentId: string; parentKey: string }, draft: NewTopicDraft): Promise<string> {
  const name = draft.name.trim();
  if (!name) throw new Error("Give the topic a name.");
  const result = await request("sessions.create", {
    agentId: target.agentId,
    parentSessionKey: target.parentKey,
    label: name,
    displayName: name,
  }) as { key?: unknown };
  if (typeof result.key !== "string" || !result.key) throw new Error("The engine made no topic.");
  if (draft.colour) await request("sessions.patch", { key: result.key, agentId: target.agentId, color: draft.colour });
  rememberTopicIcon(result.key, draft.icon);
  return result.key;
}
