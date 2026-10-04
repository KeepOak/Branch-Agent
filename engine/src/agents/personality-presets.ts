// Adapted from letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba src/agent/personality-presets.ts
// and src/agent/personality.ts (presets that seed the persona and human files of a new agent).
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SOUL_FILENAME, DEFAULT_USER_FILENAME } from "./workspace-bootstrap-policy.js";
import { resolveWorkspaceTemplateSearchDirs } from "./workspace-templates.js";

export type PersonalityOption = {
  id: "blank" | "rooted" | "blossom" | "thorn";
  label: string;
  description: string;
};

/** Upstream memo, blank, kawaii and linus presets under tree-themed names. */
export const PERSONALITY_OPTIONS: readonly PersonalityOption[] = [
  { id: "rooted", label: "Rooted", description: "The memory-first agent" },
  { id: "blank", label: "Blank", description: "Blank starter — you provide the personality" },
  { id: "thorn", label: "Thorn", description: "Code with a stern hand" },
  { id: "blossom", label: "Blossom", description: "sugoi~ (◕‿◕)✨" },
];

export type PersonalityId = PersonalityOption["id"];

/** Persona (SOUL.md) and human (USER.md) files a personality seeds. */
export type PersonalityFiles = Record<
  typeof DEFAULT_SOUL_FILENAME | typeof DEFAULT_USER_FILENAME,
  string
>;

const PERSONALITY_ALIASES: Record<string, PersonalityId> = {
  memo: "rooted",
  kawaii: "blossom",
  linus: "thorn",
};

export function getPersonalityOption(personalityId: PersonalityId): PersonalityOption {
  const option = PERSONALITY_OPTIONS.find((candidate) => candidate.id === personalityId);
  if (!option) {
    throw new Error(`Unknown personality: ${personalityId}`);
  }
  return option;
}

export function resolvePersonalityId(input: string): PersonalityId | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const direct = PERSONALITY_OPTIONS.find((candidate) => candidate.id === normalized);
  if (direct) {
    return direct.id;
  }
  return PERSONALITY_ALIASES[normalized] ?? null;
}

async function readPersonalityFile(
  personalityId: PersonalityId,
  fileName: string,
): Promise<string> {
  for (const templatesDir of await resolveWorkspaceTemplateSearchDirs()) {
    try {
      const content = await fs.readFile(
        path.join(templatesDir, "personalities", personalityId, fileName),
        "utf-8",
      );
      if (!content.trim()) {
        throw new Error(`Personality ${personalityId} has an empty ${fileName}`);
      }
      return `${content.trimEnd()}\n`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error(`Bundled personality is missing: ${personalityId}/${fileName}`);
}

/** Load the persona and human content a personality seeds into SOUL.md and USER.md. */
export async function loadPersonalityFiles(
  personalityId: PersonalityId,
): Promise<PersonalityFiles> {
  getPersonalityOption(personalityId);
  const [soul, user] = await Promise.all([
    readPersonalityFile(personalityId, DEFAULT_SOUL_FILENAME),
    readPersonalityFile(personalityId, DEFAULT_USER_FILENAME),
  ]);
  return { [DEFAULT_SOUL_FILENAME]: soul, [DEFAULT_USER_FILENAME]: user };
}
