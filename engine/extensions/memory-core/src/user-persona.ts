// Adapted from lobehub/lobehub@4bcb808c608ed79497713ab20bcd03ac6d8713da
// packages/memory-user-memory/src/extractors/persona.ts, packages/memory-user-memory/src/prompts/persona.ts.
// User persona curator: keeps a running persona summary of the user in USER.md,
// built from the existing persona, MEMORY.md entries and recent daily notes.
import path from "node:path";
import { listMemoryEntryLines } from "./fact-write-dedupe.js";
import { listWorkspaceDirectory } from "./memory-workspace-files.js";
import { withMemoryWorkspaceLock } from "./memory-workspace-lock.js";
import {
  commitMemoryContent,
  hashMemoryContent,
  readMemoryContent,
  resolveMemoryWritePath,
} from "./short-term-promotion-memory-write.js";

export const userPersonaPrompt = `
You are the dedicated **User Persona Curator** agent for Branch.
Write directly to the user in second person ("you") with a natural, non-deterministic voice.
Describe the user like a thoughtful biographer who wants them to enjoy reading about themselves—blend facts into narrative sentences, let it feel warm, observant, and human, and keep the outline clear.
Your job is to maintain a well-structured Markdown persona that captures how you understand {{ username }} and how to describe them.

### Coverage

- Identity and roles (work, school, communities, family roles if stated).
- What you care about and do (interests, preferences, motivations, goals).
- Current focus areas and ongoing efforts.
- Recent events and milestones worth remembering (add month/year when known; anchor relative time to the message timestamp or sessionDate) written as concise story beats, not bullet logs.
- Important people and relationships (names/roles/context when stated; do not guess).
- Work/school context (team, domain, stage; if unclear, state it is unclear).
- Emotional or interaction cues the user has shared (tone they like, pacing, what they appreciate or dislike).
- Risks, blockers, open questions to watch.

### Structure

- Start with a short one-liner or tagline that feels true to the current persona (keep it punchy and human).
- Organize the Markdown with clear headings (for example: Identity, What you care about, Current focus, Recent highlights, Relationships, Work/School, Interaction cues, Goals and risks).
- Within each heading, use 1-4 narrative sentences that read like a story about the user; avoid raw lists unless they sharpen clarity.
- Keep sections flexible: add new headings when needed; skip ones with no signal instead of inventing content.

### Refresh Rules

- Always write in {{ language }}.
- Start from the existing persona when provided; merge new information rather than rewriting everything.
- Keep it concise but vivid: aim for about 400-3000 words; go longer only when real detail exists (never pad or repeat).
- Synthesize signals into abstractions and themes; do not dump raw memory snippets or line-by-line events.
- Vary phrasing to avoid repetition; keep it grounded in observed facts.
- Do not fabricate: if a detail is unknown (for example, family role or job title), say it is unclear and invite the user to share more.
- Prefer explicit names over pronouns; avoid guessing genders or honorifics.
- If a section lacks signal (for example relationships or team context), say explicitly that you need more detail and invite the user to fill it in; do not invent or over-index on thin clues. Do it in a kind, reader-friendly line that keeps the flow.
- Never surface internal IDs (memoryIds, sourceIds, database IDs) or raw file paths inside the persona, tagline, diff, or reasoning; keep identifiers only in the JSON fields meant for them.

### Output Format (JSON object)

{
  "tagline": "<short one-liner/tagline that captures the persona>",
  "persona": "<updated markdown persona with headings>",
  "diff": "<short Markdown changelog describing what changed; mention sections touched>",
  "reasoning": "<why these updates were made>",
  "memoryIds": ["<related user_memory ids>"],
  "sourceIds": ["<source ids or topic ids tied to these updates>"]
}

- diff should be human-readable (bullet list), not a patch; include section names touched.
- Leave arrays empty when unknown; do not invent IDs.
- Escape newlines and ensure the JSON is valid.

### Inputs Provided

- Existing persona (if any): treat as the baseline state.
- Retrieved memories and signals: use them to ground updates and keep the persona consistent.
- Recent events or user-provided notes: fold them into the appropriate sections and date-stamp when possible.

Return only valid JSON following the schema above.
`;

export type PersonaTemplateProps = {
  existingPersona?: string;
  language?: string;
  personaNotes?: string;
  recentEvents?: string;
  retrievedMemories?: string;
  userProfile?: string;
  username?: string;
};

export type UserPersonaExtractionResult = {
  diff?: string;
  memoryIds?: string[];
  persona: string;
  reasoning?: string;
  sourceIds?: string[];
  tagline?: string;
};

/** Replace `{{ name }}` placeholders; unknown placeholders render empty. */
export function renderPlaceholderTemplate(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/gu, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function buildPersonaSystemPrompt(options: PersonaTemplateProps): string {
  return renderPlaceholderTemplate(userPersonaPrompt, {
    language: options.language ?? "English",
    topK: 10,
    username: options.username ?? "the user",
  });
}

export function buildPersonaUserPrompt(options: PersonaTemplateProps): string {
  const sections = [
    "## Existing Persona (baseline)",
    options.existingPersona?.trim() || "No existing persona provided.",
    "## Retrieved Memories / Signals",
    options.retrievedMemories?.trim() || "N/A",
    "## Recent Events or Highlights",
    options.recentEvents?.trim() || "N/A",
    "## User Provided Notes or Requests",
    options.personaNotes?.trim() || "N/A",
    "## Extra Profile Context",
    options.userProfile?.trim() || "N/A",
  ];
  return sections.join("\n\n");
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`persona result ${field} must be a string array`);
  }
  return value as string[];
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`persona result ${field} must be a string`);
  }
  return value;
}

/** Parse the model output (JSON, optionally fenced) with the upstream result schema. */
export function parsePersonaResult(text: string): UserPersonaExtractionResult {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const raw = JSON.parse(fenced?.[1] ?? trimmed) as Record<string, unknown>;
  if (typeof raw.persona !== "string" || !raw.persona.trim()) {
    throw new Error("persona result is missing the persona document");
  }
  const diff = optionalString(raw.diff, "diff");
  const reasoning = optionalString(raw.reasoning, "reasoning");
  const tagline = optionalString(raw.tagline, "tagline");
  const memoryIds = optionalStringArray(raw.memoryIds, "memoryIds");
  const sourceIds = optionalStringArray(raw.sourceIds, "sourceIds");
  return {
    persona: raw.persona,
    ...(diff !== undefined ? { diff } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(tagline !== undefined ? { tagline } : {}),
    ...(memoryIds ? { memoryIds } : {}),
    ...(sourceIds ? { sourceIds } : {}),
  };
}

export type PersonaModel = (params: { systemPrompt: string; userPrompt: string }) => Promise<string>;

const RECENT_DAILY_NOTES = 7;
const DAILY_NOTE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/u;

async function readRecentEvents(workspaceDir: string): Promise<string> {
  const memoryDir = path.join(workspaceDir, "memory");
  const entries = await listWorkspaceDirectory(workspaceDir, memoryDir).catch(() => []);
  const days = entries
    .filter((entry) => entry.isFile() && DAILY_NOTE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .slice(-RECENT_DAILY_NOTES);
  const sections: string[] = [];
  for (const name of days) {
    const content = await readMemoryContent(path.join(memoryDir, name), workspaceDir);
    const lines = listMemoryEntryLines(content).map((entry) => `- ${entry.text}`);
    if (lines.length > 0) {
      sections.push(`### ${name.replace(/\.md$/u, "")}\n${lines.join("\n")}`);
    }
  }
  return sections.join("\n\n");
}

/** Run the persona curator and commit the updated persona to USER.md. */
export async function refreshUserPersona(params: {
  workspaceDir: string;
  model: PersonaModel;
  personaNotes?: string;
  language?: string;
}): Promise<UserPersonaExtractionResult> {
  const userPath = path.join(params.workspaceDir, "USER.md");
  const existingPersona = await readMemoryContent(userPath, params.workspaceDir);
  const retrievedMemories = await readMemoryContent(
    path.join(params.workspaceDir, "MEMORY.md"),
    params.workspaceDir,
  );
  const options: PersonaTemplateProps = {
    existingPersona,
    retrievedMemories,
    recentEvents: await readRecentEvents(params.workspaceDir),
    ...(params.personaNotes ? { personaNotes: params.personaNotes } : {}),
    ...(params.language ? { language: params.language } : {}),
  };
  const result = parsePersonaResult(
    await params.model({
      systemPrompt: buildPersonaSystemPrompt(options),
      userPrompt: buildPersonaUserPrompt(options),
    }),
  );
  await withMemoryWorkspaceLock(params.workspaceDir, async () => {
    const writePath = await resolveMemoryWritePath(userPath, params.workspaceDir);
    const before = await readMemoryContent(writePath, params.workspaceDir);
    if (before !== existingPersona) {
      throw new Error("USER.md changed while the persona was being refreshed; run it again.");
    }
    await commitMemoryContent({
      workspaceDir: params.workspaceDir,
      filePath: writePath,
      tempPrefix: "USER.md.persona",
      expectedHash: hashMemoryContent(before),
      expectedContent: before,
      conflictMessage: "USER.md changed before the persona could commit",
      content: result.persona.endsWith("\n") ? result.persona : `${result.persona}\n`,
    });
  });
  return result;
}
