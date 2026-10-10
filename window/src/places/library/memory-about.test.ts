import { describe, expect, it } from "vitest";
import { aboutYouSummary } from "./memory-about";

/** Shipped USER.md after the engine strips docs front matter. */
export const USER_TEMPLATE = `# USER.md - User Model

Store stable user preferences and profile facts as directives that can guide future sessions.

Use one directive per entry:

\`\`\`md
<!-- observed: YYYY-MM-DD | status: active -->

- Prefer concise progress updates during implementation work.
\`\`\`

- Begin each directive with an imperative such as \`Always\`, \`Never\`, or \`Prefer\`.
- Record the observation date and either \`active\` or \`superseded\` on the metadata line.
- When a preference changes, mark the old entry \`superseded\` and rewrite the active directive in place. Never append a contradictory active directive.
- Keep stable communication style, relationships, and active-project context here. Put durable non-profile facts and decisions in \`MEMORY.md\`.
- Save this file at the workspace root as \`USER.md\`. It loads every session with a separate 4,000-character budget.

## Directives

Replace the example below with a real directive and a real observation date before you save this file. Never leave a placeholder directive \`active\`.

<!-- observed: YYYY-MM-DD | status: active -->

- Prefer ...

## Related

- [Agent workspace](/concepts/agent-workspace)
`;

const FACTS = `<!-- observed: 2026-09-12 | status: active -->

- Prefers short replies while a task is running
- Works from Lisbon most weekdays
`;

describe("aboutYouSummary", () => {
  it("treats the untouched USER.md template as empty", () => {
    expect(aboutYouSummary(USER_TEMPLATE)).toBe("");
    expect(aboutYouSummary("")).toBe("");
    expect(aboutYouSummary("# USER.md\n\n")).toBe("");
  });

  it("keeps real facts and drops template boilerplate, fences, comments and docs links", () => {
    const summary = aboutYouSummary(`${USER_TEMPLATE}\n${FACTS}`);
    expect(summary).toBe("Prefers short replies while a task is running\nWorks from Lisbon most weekdays");
    expect(summary).not.toMatch(/Store stable user preferences|```|observed:|Save this file|Agent workspace|Prefer \.\.\./);
  });

  it("keeps a real preference that only contains a template phrase", () => {
    expect(aboutYouSummary("- Always record the observation date for my health measurements.\n")).toBe(
      "Always record the observation date for my health measurements.",
    );
  });

  it("drops superseded directives and keeps the active replacement", () => {
    const summary = aboutYouSummary(`<!-- observed: 2026-01-01 | status: superseded -->
- Used to work from Porto
<!-- observed: 2026-09-12 | status: active -->
- Works from Lisbon most weekdays
`);
    expect(summary).toBe("Works from Lisbon most weekdays");
    expect(summary).not.toContain("Porto");
  });
});
