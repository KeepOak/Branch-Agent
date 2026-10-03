import { isRecord } from "@branch/normalization-core/record-coerce";
import { redactSensitiveText } from "../../logging/redact.js";

// NousResearch/hermes-agent 18d125cc, agent/context_compressor.py ghost-skill defense.
export const SKILL_PRUNED_MARKER_PREFIX = "[SKILL_PRUNED:";
export const SKILL_VIEW_PRUNE_MIN_CHARS = 5000;
export const MAX_PRUNED_SKILL_MARKERS = 20;
const SKILL_PRUNE_RECENT_WINDOW = 10;
export type SkillTranscriptMessage = {
  role: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
};
type SkillCallSite = { index: number; id: string; name: string };

export function skillPrunedMarker(name: string): string {
  return `${SKILL_PRUNED_MARKER_PREFIX} content lost in compression; reload with skills_read(name=${JSON.stringify(name)})]`;
}

export function extractPrunedSkillNames(text: string): string[] {
  const names: string[] = [];
  const pattern =
    /\[SKILL_PRUNED: content lost in compression; reload with skills_read\(name=("(?:[^"\\]|\\.)*")\)\]/gu;
  for (const match of text.matchAll(pattern)) {
    try {
      const name: unknown = JSON.parse(match[1] ?? "");
      if (typeof name === "string" && name) {
        names.push(name);
      }
    } catch {
      /* A malformed marker never authorizes an invented skill read. */
    }
  }
  return [...new Set(names)];
}

export function skillMessageText(message: SkillTranscriptMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

export function skillReadCallSites(messages: readonly SkillTranscriptMessage[]): SkillCallSite[] {
  const sites: SkillCallSite[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (const block of message.content) {
      if (
        !isRecord(block) ||
        block.type !== "toolCall" ||
        block.name !== "skills_read" ||
        typeof block.id !== "string"
      ) {
        continue;
      }
      const args = block.arguments;
      if (isRecord(args) && typeof args.name === "string" && args.name) {
        sites.push({ index, id: block.id, name: args.name });
      }
    }
  }
  return sites;
}

/** Python source length counts Unicode code points rather than UTF-16 units. */
export function skillInstructionLength(message: SkillTranscriptMessage): number {
  return [...skillMessageText(message)].length;
}

export function collectGhostedSkillNames(messages: readonly SkillTranscriptMessage[]): string[] {
  const calls = new Map(skillReadCallSites(messages).map((site) => [site.id, site.name]));
  const names: string[] = [];
  for (const message of messages) {
    const text = skillMessageText(message);
    names.push(...extractPrunedSkillNames(text));
    if (
      message.role === "toolResult" &&
      message.toolName === "skills_read" &&
      [...text].length > SKILL_VIEW_PRUNE_MIN_CHARS
    ) {
      const name = calls.get(message.toolCallId ?? "");
      if (name) {
        names.push(name);
      }
    }
  }
  return [...new Set(names)];
}

export function collectProtectedSkillNames(
  messages: readonly SkillTranscriptMessage[],
  pruneBoundary: number,
): Set<string> {
  const recentStart = Math.max(0, messages.length - SKILL_PRUNE_RECENT_WINDOW);
  const tailStart = Math.max(0, pruneBoundary);
  const tailUsers = messages
    .slice(tailStart)
    .filter((message) => message.role === "user")
    .map((message) => skillMessageText(message).toLowerCase());
  return new Set(
    skillReadCallSites(messages)
      .filter(
        (site) =>
          site.index >= Math.min(recentStart, tailStart) ||
          tailUsers.some((text) => text.includes(site.name.toLowerCase())),
      )
      .map((site) => site.name.toLowerCase()),
  );
}

export function reinjectPrunedSkillMarkers(summary: string, names: readonly string[]): string {
  const missing = [...new Set(names)]
    .map(skillPrunedMarker)
    .filter((marker) => !summary.includes(marker));
  if (missing.length === 0) {
    return summary;
  }
  const block =
    `\n\n## Pruned Skills\n${missing.join("\n")}\n` +
    "(The listed skills' instructions were pruned during context compression. Reload with the skills_read call in each marker before relying on that skill; one reload per skill is enough — ignore any older markers for the same skill.)";
  return summary + redactSensitiveText(block, { mode: "tools" });
}
