import path from "node:path";
import { readWorkspaceFile } from "./memory-workspace-files.js";

// Preserve the native workspace prompt budget from the upstream Dream loader.
export const WORKSPACE_DREAM_PROMPT_MAX_CHARS = 32_000;

/** Missing, unreadable, invalid UTF-8 and empty overrides restore the default. */
export async function loadWorkspaceDreamPrompt(workspaceDir: string): Promise<string | undefined> {
  try {
    const bytes = await readWorkspaceFile(workspaceDir, path.join(workspaceDir, "prompts", "dream.md"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimEnd();
    if (!text) {
      return undefined;
    }
    // Python's source loader budgets Unicode characters, not UTF-16 units.
    return Array.from(text).slice(0, WORKSPACE_DREAM_PROMPT_MAX_CHARS).join("");
  } catch {
    return undefined;
  }
}
