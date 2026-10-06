// From openclaw/openclaw@8177060846209e40a506e442785a7736f31db674:src/hooks/frontmatter.test.ts (atlas AUTOMATION-0070). Changed for Branch: rebranded through scripts/rebrand-map.json; retain current upstream regression coverage instead of older atlas tests.
// Hook frontmatter tests cover hook metadata parsing from hook files.
import { expectDefined } from "@branch/normalization-core";
import { describe, expect, it } from "vitest";
import { parseHookFrontmatter, resolveHookManifestMetadata } from "./frontmatter.js";

function requireString(value: string | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`expected ${label}`);
  }
  return value;
}

describe("parseHookFrontmatter", () => {
  it("handles CRLF line endings", () => {
    const content = "---\r\nname: test\r\ndescription: crlf\r\n---\r\n";
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("crlf");
  });

  it("handles CR line endings", () => {
    const content = "---\rname: test\rdescription: cr\r---\r";
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("cr");
  });
});

describe("resolveHookManifestMetadata", () => {
  it("extracts branch metadata from parsed frontmatter", () => {
    const frontmatter = {
      name: "test-hook",
      metadata: JSON.stringify({
        branch: {
          emoji: "🔥",
          events: ["command:new", "command:reset"],
          requires: {
            config: ["workspace.dir"],
            bins: ["git"],
          },
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    const branch = expectDefined(result, "hook metadata");
    expect(branch.emoji).toBe("🔥");
    expect(branch.events).toEqual(["command:new", "command:reset"]);
    expect(branch.requires?.config).toEqual(["workspace.dir"]);
    expect(branch.requires?.bins).toEqual(["git"]);
  });

  it("returns undefined when metadata is missing", () => {
    const frontmatter = { name: "no-metadata" };
    const result = resolveHookManifestMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("handles install specs", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        branch: {
          events: ["command"],
          install: [
            { id: "bundled", kind: "bundled", label: "Bundled with Branch Agent" },
            { id: "npm", kind: "npm", package: "@branch/hook" },
          ],
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    expect(result?.install).toHaveLength(2);
    expect(expectDefined(result?.install?.[0], "result?.install?.[0] test invariant").kind).toBe(
      "bundled",
    );
    expect(expectDefined(result?.install?.[1], "result?.install?.[1] test invariant").kind).toBe(
      "npm",
    );
    expect(expectDefined(result?.install?.[1], "result?.install?.[1] test invariant").package).toBe(
      "@branch/hook",
    );
  });

  it("handles os restrictions", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        branch: {
          events: ["command"],
          os: ["darwin", "linux"],
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    expect(result?.os).toEqual(["darwin", "linux"]);
  });

  it("parses real session-memory HOOK.md format", () => {
    // This is the actual format used in the bundled hooks
    const content = `---
name: session-memory
description: "Save session context to memory when a session is reset"
homepage: https://docs.openclaw.ai/automation/hooks#session-memory
metadata:
  {
    "branch":
      {
        "emoji": "💾",
        "events": ["command:new", "command:reset", "session:auto-reset"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with Branch Agent" }],
      },
  }
---

# Session Memory Hook
`;

    const frontmatter = parseHookFrontmatter(content);
    expect(frontmatter.name).toBe("session-memory");
    expect(requireString(frontmatter.metadata, "session-memory metadata")).toContain(
      '"command:reset"',
    );

    const branch = expectDefined(resolveHookManifestMetadata(frontmatter), "hook metadata");
    expect(branch.emoji).toBe("💾");
    expect(branch.events).toEqual(["command:new", "command:reset", "session:auto-reset"]);
    expect(branch.requires?.config).toEqual(["workspace.dir"]);
    expect(expectDefined(branch.install?.[0], "branch.install?.[0] test invariant").kind).toBe(
      "bundled",
    );
  });

  it("parses YAML metadata map", () => {
    const content = `---
name: yaml-metadata
metadata:
  branch:
    emoji: disk
    events:
      - command:new
---
`;
    const frontmatter = parseHookFrontmatter(content);
    const branch = resolveHookManifestMetadata(frontmatter);
    expect(branch?.emoji).toBe("disk");
    expect(branch?.events).toEqual(["command:new"]);
  });
});
