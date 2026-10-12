// openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31:codex-rs/external-agent-migration/src/rewrite.rs (atlas TOOLS-0139)
// Same rewrite as codex-rs/core-plugins/src/command_migration/render.rs, applied to
// imported Claude commands. Codex's replacement word "Codex" becomes "Branch Agent".

/** Source-specific terms rewritten in migrated artifacts. */
export type RewriteProfile = {
  docFileName: string;
  termVariants: readonly string[];
  caseSensitiveTermVariants?: readonly string[];
};

/** Codex ClaSource::REWRITE_PROFILE. */
export const CLAUDE_REWRITE_PROFILE: RewriteProfile = {
  docFileName: "CLAUDE.md",
  termVariants: ["claude code", "claude-code", "claude_code", "claudecode", "claude"],
};

export const REWRITTEN_DOC_FILE_NAME = "AGENTS.md";
export const REWRITTEN_PRODUCT_NAME = "Branch Agent";

/** Rewrites source documentation names and product terms to their Branch Agent forms. */
export function rewriteTerms(content: string, profile: RewriteProfile): string {
  let rewritten = replaceWithBoundaries(content, profile.docFileName, REWRITTEN_DOC_FILE_NAME, {
    caseInsensitive: true,
  });
  for (const from of profile.termVariants) {
    rewritten = replaceWithBoundaries(rewritten, from, REWRITTEN_PRODUCT_NAME, {
      caseInsensitive: true,
    });
  }
  for (const from of profile.caseSensitiveTermVariants ?? []) {
    rewritten = replaceWithBoundaries(rewritten, from, REWRITTEN_PRODUCT_NAME, {
      caseInsensitive: false,
    });
  }
  return rewritten;
}

// Rust's to_ascii_lowercase keeps every index in place; String#toLowerCase may not.
function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z0-9_]$/.test(char);
}

function replaceWithBoundaries(
  input: string,
  needle: string,
  replacement: string,
  opts: { caseInsensitive: boolean },
): string {
  const searchNeedle = opts.caseInsensitive ? asciiLowercase(needle) : needle;
  if (!searchNeedle) {
    return input;
  }
  const haystack = opts.caseInsensitive ? asciiLowercase(input) : input;
  let output = "";
  let lastEmitted = 0;
  let searchStart = 0;
  let replaced = false;
  for (;;) {
    const start = haystack.indexOf(searchNeedle, searchStart);
    if (start < 0) {
      break;
    }
    const end = start + searchNeedle.length;
    if (start >= lastEmitted && !isWordChar(input[start - 1]) && !isWordChar(input[end])) {
      output += input.slice(lastEmitted, start) + replacement;
      lastEmitted = end;
      replaced = true;
    }
    // Upstream advances one byte after a case-insensitive hit and past the hit otherwise.
    searchStart = opts.caseInsensitive ? start + 1 : end;
  }
  return replaced ? output + input.slice(lastEmitted) : input;
}
