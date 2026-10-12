// Kilo-Org/kilocode@6fd9b7b29ce63b5a38176e45b738e94ed6167cfb:packages/opencode/test/kilocode/bash-hierarchy.test.ts (atlas SAFETY-0005)
import { describe, expect, it } from "vitest";
import { commandArityPrefix } from "./command-arity.js";
import {
  addCommandPrefixPatterns,
  commandMatchesPrefixPattern,
  commandPrefixChoices,
} from "./command-prefix-hierarchy.js";

function collect(command: string[], text: string): string[] {
  const set = new Set<string>();
  addCommandPrefixPatterns(set, command, text);
  return [...set];
}

describe("BashHierarchy.addAll", () => {
  it("arity-1 command with args produces base wildcard + exact", () => {
    const result = collect(["ls", "-la"], "ls -la");
    expect(result).toContain("ls *");
    expect(result).toContain("ls -la");
  });

  it("arity-2 command without extra args skips redundant exact text", () => {
    const result = collect(["git", "status"], "git status");
    expect(result).toEqual(["git *", "git status *"]);
  });

  it("arity-2 command with extra args includes exact text", () => {
    const result = collect(["npm", "install", "lodash"], "npm install lodash");
    expect(result).toEqual(["npm *", "npm install *", "npm install lodash"]);
  });

  it("arity-3 command without extra args skips redundant exact text", () => {
    const result = collect(["npm", "run", "dev"], "npm run dev");
    expect(result).toEqual(["npm *", "npm run *", "npm run dev *"]);
  });

  it("arity-3 command with extra args includes exact text", () => {
    const result = collect(["docker", "compose", "up", "-d"], "docker compose up -d");
    expect(result).toEqual([
      "docker *",
      "docker compose *",
      "docker compose up *",
      "docker compose up -d",
    ]);
  });

  it("single token command without args skips redundant exact text", () => {
    const result = collect(["pwd"], "pwd");
    expect(result).toEqual(["pwd *"]);
  });

  it("empty command returns empty", () => {
    const result = collect([], "");
    expect(result).toEqual([]);
  });

  it("unknown command with args includes exact text", () => {
    const result = collect(["mycustomtool", "arg1", "arg2"], "mycustomtool arg1 arg2");
    expect(result).toEqual(["mycustomtool *", "mycustomtool arg1 arg2"]);
  });

  it("duplicates are deduplicated by Set", () => {
    const set = new Set<string>();
    addCommandPrefixPatterns(set, ["git", "status"], "git status");
    addCommandPrefixPatterns(set, ["git", "diff"], "git diff");
    expect([...set].filter((p) => p === "git *")).toHaveLength(1);
  });
});

describe("command prefix choices (behaviour)", () => {
  it("uses the curated arity table for git checkout and npm run dev", () => {
    expect(commandArityPrefix(["git", "checkout", "main"])).toEqual(["git", "checkout"]);
    expect(commandArityPrefix(["npm", "run", "dev", "--", "--port", "3000"])).toEqual([
      "npm",
      "run",
      "dev",
    ]);
  });

  it("offers npm, npm install and npm install lodash for one command", () => {
    expect(commandPrefixChoices("npm install lodash")).toEqual([
      "npm *",
      "npm install *",
      "npm install lodash",
    ]);
  });

  it("offers only the exact string for chained or substituted commands", () => {
    expect(commandPrefixChoices("npm install && rm -rf /")).toEqual(["npm install && rm -rf /"]);
    expect(commandPrefixChoices("echo $(whoami)")).toEqual(["echo $(whoami)"]);
  });

  it("a chosen prefix covers longer commands but never a chained one", () => {
    expect(commandMatchesPrefixPattern("npm install *", "npm install react")).toBe(true);
    expect(commandMatchesPrefixPattern("npm install *", "npm install")).toBe(true);
    expect(commandMatchesPrefixPattern("npm install *", "npm installer")).toBe(false);
    expect(commandMatchesPrefixPattern("npm install *", "npm install x; rm -rf /")).toBe(false);
    expect(commandMatchesPrefixPattern("npm install lodash", "npm install lodash")).toBe(true);
    expect(commandMatchesPrefixPattern("npm install lodash", "npm install lodash2")).toBe(false);
  });
});
