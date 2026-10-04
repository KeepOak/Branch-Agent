import * as fs from "node:fs/promises";
// Upstream glob handler/walker cases, adapted to Branch native operations.
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSandboxPath } from "../agents/sandbox-paths.js";
import { createGlobTool } from "../agents/tools/glob-tool.js";
import { matchesGlobPattern, walkContainedGlob, type GlobOperations } from "./glob-search.js";

const scratch = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "coding",
);
const CAPABILITY_ROUTER_SERVICE_TYPE = "capability-router";
type IAgentRuntime = { root: string; getService: <T>(serviceType: string) => T | null };
type Memory = { roomId?: string };
type State = undefined;
type TestEnv = {
  runtime: IAgentRuntime;
  message: Memory;
  sessionCwd: { setCwd: (id: string, cwd: string) => void };
  cleanup: () => Promise<void>;
};

async function setupEnv(
  _label: string,
  options: { rootsPath: string; extraSettings: unknown },
): Promise<TestEnv> {
  const runtime: IAgentRuntime = { root: options.rootsPath, getService: () => null };
  return {
    runtime,
    message: { roomId: "test-room" },
    sessionCwd: {
      setCwd: (_id, cwd) => {
        runtime.root = cwd;
      },
    },
    cleanup: async () => {},
  };
}

function fixtureOperations(root: string): GlobOperations {
  return {
    validatePath: async (filePath) => {
      if (filePath.includes("_blocked")) throw new Error("path_blocked");
      await assertSandboxPath({ filePath, cwd: root, root }).catch((error) => {
        throw new Error(`outside the configured coding workspace: ${String(error)}`);
      });
    },
    readDirectory: async (directory) =>
      (await fs.readdir(directory, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
    stat: async (filePath) => {
      const info = await fs.stat(filePath);
      return { type: info.isFile() ? "file" : "other", mtimeMs: info.mtimeMs };
    },
  };
}

async function globHandler(
  runtime: IAgentRuntime,
  message: Memory,
  _state: State,
  options: unknown,
  _callback?: unknown,
) {
  if (!message.roomId) return { success: false, text: "missing_param: no roomId", data: undefined };
  const params = (options as { parameters: { pattern: string; path?: string } }).parameters;
  if (!params.pattern)
    return { success: false, text: "missing_param: pattern is required", data: undefined };
  try {
    const result = await createGlobTool(runtime.root, {
      root: runtime.root,
      operations: fixtureOperations(runtime.root),
    }).execute("upstream", params);
    const first = result.content[0];
    return {
      success: true,
      text: first?.type === "text" ? first.text : "",
      data: result.details,
    };
  } catch (error) {
    return {
      success: false,
      text: `invalid_param: glob candidate rejected: ${String(error)}`,
      data: undefined,
    };
  }
}

let testContainer: string;
let tmpRoot: string;
let env: TestEnv;
let blockedPath: string;
let outsideRoot: string;

beforeEach(async () => {
  await fs.mkdir(scratch, { recursive: true });
  testContainer = await fs.mkdtemp(path.join(scratch, "ct-glob-"));
  tmpRoot = path.join(testContainer, "root");
  outsideRoot = path.join(testContainer, "outside");
  await fs.mkdir(tmpRoot);
  await fs.mkdir(outsideRoot);
  blockedPath = path.join(tmpRoot, "_blocked");
  env = await setupEnv("ct-glob", {
    rootsPath: tmpRoot,
    extraSettings: { CODING_TOOLS_WORKSPACE_ROOTS: tmpRoot },
  });
  env.sessionCwd.setCwd("test-room", tmpRoot);
  const fooDir = path.join(tmpRoot, "foo");
  const subDir = path.join(fooDir, "sub");
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(path.join(fooDir, "a.ts"), "export const A = 1;\n");
  await fs.writeFile(path.join(fooDir, "b.ts"), "export const B = 2;\n");
  await fs.writeFile(path.join(subDir, "c.ts"), "export const C = 3;\n");
  await fs.writeFile(path.join(fooDir, "notes.md"), "# notes\n");
  await fs.writeFile(path.join(tmpRoot, ".hidden"), "root hidden\n");
  await fs.writeFile(path.join(fooDir, ".nested.ts"), "nested hidden\n");
  await fs.mkdir(path.join(tmpRoot, ".hidden-dir"));
  await fs.writeFile(path.join(tmpRoot, ".hidden-dir", "inside.ts"), "hidden directory\n");
});

afterEach(async () => {
  try {
    await env.cleanup();
  } finally {
    await fs.rm(testContainer, { recursive: true, force: true });
  }
});

const state: State | undefined = undefined;

describe("GLOB", () => {
  it("matches **/*.ts and returns expected count", async () => {
    const { runtime, message } = env;
    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "**/*.ts" },
    });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown> | undefined;
    const files = data?.files as string[] | undefined;
    expect(Array.isArray(files)).toBe(true);
    expect(files?.length).toBe(3);
    const sortedNames = [...(files ?? [])].sort();
    expect(sortedNames.some((p) => p.endsWith("a.ts"))).toBe(true);
    expect(sortedNames.some((p) => p.endsWith("b.ts"))).toBe(true);
    expect(sortedNames.some((p) => p.endsWith("c.ts"))).toBe(true);
    expect(data?.truncated).toBe(false);
    expect(result.text).toMatch(/^3 files\n/);
  });

  it("keeps glob plugin-owned until fs.glob parity exists", async () => {
    const { runtime, message } = env;
    const guardedRuntime = {
      ...runtime,
      getService: <T>(serviceType: string): T | null => {
        if (serviceType === CAPABILITY_ROUTER_SERVICE_TYPE) {
          throw new Error("glob must not use the capability router yet");
        }
        return runtime.getService<T>(serviceType);
      },
    } as IAgentRuntime;

    const result = await globHandler(guardedRuntime, message, state, {
      parameters: { pattern: "**/*.ts" },
    });

    expect(result.success).toBe(true);
    expect(result.text).toMatch(/^3 files\n/);
  });

  it("resolves a relative path against the session cwd", async () => {
    const { runtime, message } = env;
    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "**/*.ts", path: "./foo" },
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown> | undefined;
    const files = (data?.files as string[] | undefined) ?? [];
    expect(files).toHaveLength(3);
    expect(files.every((filePath) => filePath.endsWith(".ts"))).toBe(true);
  });

  it("rejects a path under the blocklist", async () => {
    const { runtime, message } = env;
    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "**/*", path: blockedPath },
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("path_blocked");
  });

  it.each(["../outside/*.txt", "{../outside,foo}/*.txt"])(
    "rejects a traversing pattern %s",
    async (pattern) => {
      const { runtime, message } = env;
      const result = await globHandler(runtime, message, state, {
        parameters: { pattern },
      });

      expect(result.success).toBe(false);
      expect(result.text).toContain("invalid_param");
      expect(result.text).toContain("must not traverse");
    },
  );

  it.each(["/tmp/*.txt", "C:\\outside\\*.txt"])(
    "rejects an absolute pattern %s",
    async (pattern) => {
      const { runtime, message } = env;
      const result = await globHandler(runtime, message, state, {
        parameters: { pattern },
      });

      expect(result.success).toBe(false);
      expect(result.text).toContain("invalid_param");
      expect(result.text).toContain("must be relative");
    },
  );

  it("does not follow a directory symlink outside the workspace", async () => {
    const { runtime, message } = env;
    await fs.writeFile(path.join(outsideRoot, "secret.txt"), "outside\n");
    await fs.symlink(outsideRoot, path.join(tmpRoot, "escape"), "dir");

    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "escape/*.txt" },
    });

    expect(result.success).toBe(true);
    expect(result.text).toBe("0 files");
  });

  it("returns an in-root file symlink without traversing it as a directory", async () => {
    const { runtime, message } = env;
    const link = path.join(tmpRoot, "linked.ts");
    await fs.symlink(path.join(tmpRoot, "foo", "a.ts"), link, "file");

    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "*.ts" },
    });

    expect(result.success).toBe(true);
    expect((result.data as { files: string[] }).files).toEqual([
      path.join(await fs.realpath(tmpRoot), "linked.ts"),
    ]);
  });

  it("rejects a matching file symlink whose target is outside the workspace", async () => {
    const { runtime, message } = env;
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await fs.writeFile(outsideFile, "outside\n");
    await fs.symlink(outsideFile, path.join(tmpRoot, "outside-link.txt"), "file");

    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "*.txt" },
    });

    expect(result.success).toBe(false);
    expect(result.text).toContain("glob candidate rejected");
    expect(result.text).toContain("outside the configured coding workspace");
  });

  it("does not descend for a pattern that cannot match a path separator", async () => {
    const visited: string[] = [];

    const files = await walkContainedGlob(tmpRoot, "*.ts", async (directory) => {
      visited.push(path.resolve(directory));
      return (await fs.readdir(directory, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    });

    expect(files).toEqual([]);
    expect(visited).toEqual([path.resolve(tmpRoot)]);
  });

  it.each([".[.]/outside/*.txt", "{.[.],safe}/outside/*.txt"])(
    "never traverses outside the root for encoded pattern %s",
    async (pattern) => {
      await fs.writeFile(path.join(outsideRoot, "secret.txt"), "outside\n");
      const visited: string[] = [];

      const files = await walkContainedGlob(tmpRoot, pattern, async (directory) => {
        visited.push(path.resolve(directory));
        return (await fs.readdir(directory, { withFileTypes: true })).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      });

      expect(files).toEqual([]);
      expect(visited).not.toContain(path.resolve(outsideRoot));
      expect(
        visited.every((directory) => {
          const relative = path.relative(tmpRoot, directory);
          return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
        }),
      ).toBe(true);
    },
  );

  it("preserves brace and recursive glob semantics inside the root", async () => {
    const { runtime, message } = env;
    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "{foo,missing}/**/{a,b,c}.ts" },
    });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown> | undefined;
    const files = (data?.files as string[] | undefined) ?? [];
    expect(files).toHaveLength(3);
    expect(files.every((filePath) => filePath.endsWith(".ts"))).toBe(true);
  });

  it.each([
    { pattern: "*", excluded: [".hidden"] },
    {
      pattern: "**/*",
      excluded: [".hidden", ".nested.ts", "inside.ts"],
    },
  ])("excludes implicit dot segments for $pattern", async ({ pattern, excluded }) => {
    const { runtime, message } = env;
    const result = await globHandler(runtime, message, state, {
      parameters: { pattern },
    });

    expect(result.success).toBe(true);
    for (const name of excluded) expect(result.text).not.toContain(name);
  });

  it.each([
    { pattern: ".*", included: ".hidden" },
    { pattern: "**/.*", included: ".nested.ts" },
    { pattern: ".hidden-dir/**/*.ts", included: "inside.ts" },
  ])("includes explicitly requested dot segments for $pattern", async ({ pattern, included }) => {
    const { runtime, message } = env;
    const result = await globHandler(runtime, message, state, {
      parameters: { pattern },
    });

    expect(result.success).toBe(true);
    expect(result.text).toContain(included);
  });

  it.each([
    { pattern: "!foo/a.ts", included: path.join("!foo", "a.ts") },
    { pattern: "#file", included: "#file" },
  ])("treats leading control syntax literally for $pattern", async ({ pattern, included }) => {
    const { runtime, message } = env;
    if (pattern.startsWith("!")) {
      await fs.mkdir(path.join(tmpRoot, "!foo"));
      await fs.writeFile(path.join(tmpRoot, "!foo", "a.ts"), "literal bang\n");
    } else {
      await fs.writeFile(path.join(tmpRoot, "#file"), "literal hash\n");
    }
    const result = await globHandler(runtime, message, state, {
      parameters: { pattern },
    });

    expect(result.success).toBe(true);
    const files = (result.data as { files: string[] }).files;
    expect(files).toHaveLength(1);
    expect(files[0]?.endsWith(included)).toBe(true);
  });

  it("fails when roomId is missing", async () => {
    const { runtime } = env;
    const result = await globHandler(runtime, {} as Memory, state, {
      parameters: { pattern: "**/*.ts" },
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("missing_param");
  });

  it("fails when pattern is missing", async () => {
    const { runtime, message } = env;
    const result = await globHandler(runtime, message, state, {
      parameters: {},
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("missing_param");
  });
});

describe("matchesGlobPattern runtime contract", () => {
  it.each([
    [".hidden", "*", false],
    [".hidden", ".*", true],
    ["nested/.hidden", "**/*", false],
    ["nested/.hidden", "**/.*", true],
    [".hidden-dir/inside.ts", "**/*.ts", false],
    [".hidden-dir/inside.ts", ".hidden-dir/**/*.ts", true],
    ["foo/a.ts", "{foo,bar}/**/*.ts", true],
    ["!foo/a.ts", "!foo/a.ts", true],
    ["foo/a.ts", "!foo/a.ts", false],
    ["#file", "#file", true],
  ] as const)("matches %s against %s as %s", (candidate, pattern, expected) => {
    expect(matchesGlobPattern(candidate, pattern)).toBe(expected);
  });
});

describe("globHandler — read-only query stays silent", () => {
  // The contract this PR establishes: raw listings/matches reach the model via
  // the ActionResult and the user via the planner's final message. Posting each
  // exploratory call's dump spammed chat (#16589) — the callback must never fire.
  it("does not invoke the visible chat callback", async () => {
    const { runtime, message } = env;
    const callback = vi.fn();
    const result = await globHandler(
      runtime,
      message,
      undefined,
      { parameters: { pattern: "**/*.ts" } },
      callback,
    );
    expect(result.success).toBe(true);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("globHandler — result ordering", () => {
  it("returns newest first and breaks equal-mtime ties by path", async () => {
    const { runtime, message } = env;
    const orderDir = path.join(tmpRoot, "order");
    await fs.mkdir(orderDir, { recursive: true });

    await fs.mkdir(path.join(orderDir, "sub"), { recursive: true });

    // Two files share an mtime, so only the tie-break separates them; a third
    // is newer and must lead regardless of its path. The tied pair is arranged
    // so that candidate discovery order (this directory's entries before the
    // subdirectory's) is the reverse of path order.
    const tied = new Date(1_700_000_000_000);
    const newer = new Date(1_800_000_000_000);
    const relativePaths = ["m-newest.ts", "z-tied.ts", "sub/a-tied.ts"];
    for (const relativePath of relativePaths) {
      const filePath = path.join(orderDir, relativePath);
      await fs.writeFile(filePath, "export const X = 1;\n");
      const mtime = relativePath === "m-newest.ts" ? newer : tied;
      await fs.utimes(filePath, mtime, mtime);
    }

    const result = await globHandler(runtime, message, state, {
      parameters: { pattern: "order/**/*.ts" },
    });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown> | undefined;
    const files = (data?.files as string[] | undefined) ?? [];
    const canonicalOrderDir = await fs.realpath(orderDir);
    expect(files.map((filePath) => path.relative(canonicalOrderDir, filePath))).toEqual([
      "m-newest.ts",
      path.join("sub", "a-tied.ts"),
      "z-tied.ts",
    ]);
  });
});
