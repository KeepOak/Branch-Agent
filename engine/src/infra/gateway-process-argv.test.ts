// Tests gateway process argv parsing for diagnostics.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { classifyBranchArgv, parseProcCmdline } from "./gateway-process-argv.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function scriptFixture(entry: string, packageName = "branch") {
  const root = tempDirs.make("process-argv-");
  const script = path.join(root, entry);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: packageName }));
  return { root, script };
}

describe("parseProcCmdline", () => {
  it("splits null-delimited argv and trims empty entries", () => {
    expect(parseProcCmdline(" node \0 gateway \0\0 --port \0 18789 \0")).toEqual([
      "node",
      "gateway",
      "--port",
      "18789",
    ]);
  });

  it("keeps non-delimited single arguments and drops whitespace-only entries", () => {
    expect(parseProcCmdline(" gateway ")).toEqual(["gateway"]);
    expect(parseProcCmdline(" \0\t\0 ")).toStrictEqual([]);
  });
});

describe("command ownership", () => {
  it("requires the requested command after verifying the installation", () => {
    const built = scriptFixture("dist/entry.js");
    for (const runtime of ["NODE", "bun", "tsx"]) {
      expect(
        classifyBranchArgv([runtime, built.script, "GATEWAY"], { command: "gateway" }).kind,
      ).toBe("branch");
      expect(
        classifyBranchArgv([runtime, built.script, "doctor"], { command: "gateway" }).kind,
      ).toBe("other");
    }
    expect(classifyBranchArgv(["node", built.script, "doctor"], { command: "doctor" }).kind).toBe(
      "branch",
    );
    expect(
      classifyBranchArgv(["python", "doctor", "worker.py"], { command: "doctor" }).kind,
    ).toBe("other");
  });

  it("recognizes specific CLI and retitled command identities", () => {
    expect(
      classifyBranchArgv(["C:\\bin\\branch.cmd", "gateway"], { command: "gateway" }).kind,
    ).toBe("branch");
    expect(
      classifyBranchArgv(["/usr/local/bin/branch-gateway"], { command: "gateway" }).kind,
    ).toBe("branch");
    expect(
      classifyBranchArgv(["C:\\bin\\branch-gateway.EXE"], { command: "gateway" }).kind,
    ).toBe("branch");
    expect(classifyBranchArgv(["branch-doctor"], { command: "gateway" }).kind).toBe("other");
  });

  it("does not mistake application arguments or root-option values for the command", () => {
    for (const argv of [
      ["branch", "agent", "--message", "gateway"],
      ["branch", "--profile", "gateway", "status"],
    ]) {
      expect(classifyBranchArgv(argv, { command: "gateway" }).kind).toBe("other");
    }
  });
});

describe("Branch Agent process owners", () => {
  it.each([
    ["local TUI", ["node", "/srv/branch/branch.mjs", "tui", "--local"]],
    ["bare local TUI", ["branch"]],
  ])("recognizes the %s embedded owner", (_label, argv) => {
    expect(classifyBranchArgv(argv).kind).toBe("branch");
  });

  it("rejects an unrelated process", () => {
    expect(classifyBranchArgv(["python", "worker.py"]).kind).toBe("other");
  });

  it.each([undefined, "gateway"])(
    "rejects a standalone foreign script for command %s despite missing package identity",
    (command) => {
      const other = scriptFixture("service.js", "unrelated-service");
      fs.unlinkSync(path.join(other.root, "package.json"));
      expect(classifyBranchArgv(["node", other.script], { command }).kind).toBe("other");
    },
  );
});

describe("classifyBranchArgv", () => {
  it.each(["--inspect", "--inspect-brk", "--inspect-wait", "--expose-gc"])(
    "keeps the script after the boolean %s option",
    (flag) => {
      const owned = scriptFixture("dist/index.js");
      expect(classifyBranchArgv(["node", flag, owned.script, "gateway"]).kind).toBe("branch");
    },
  );
  it("resolves the script after the tsx watch subcommand", () => {
    const owned = scriptFixture("src/index.ts");
    expect(classifyBranchArgv(["tsx", "watch", owned.script, "gateway"]).kind).toBe("branch");
  });
  it("uses the resolved entrypoint when argv contains only its basename or extra separators", () => {
    const owned = scriptFixture("dist/index.js");
    expect(
      classifyBranchArgv(["node", "index.js"], { cwd: path.dirname(owned.script) }).kind,
    ).toBe("branch");
    expect(classifyBranchArgv(["node", "./dist//index.js"], { cwd: owned.root }).kind).toBe(
      "branch",
    );
  });

  it("verifies the package owning a resolved launcher target", () => {
    const owned = scriptFixture("branch.mjs");
    const resolved = vi.spyOn(fs, "realpathSync").mockReturnValue(owned.script);
    try {
      expect(classifyBranchArgv(["node", path.join(owned.root, "dist/index.js")]).kind).toBe(
        "branch",
      );
    } finally {
      resolved.mockRestore();
    }
  });

  it("recognizes Bun run after runtime flags without consuming a script named run twice", () => {
    const owned = scriptFixture("dist/index.js");
    const other = scriptFixture("run", "unrelated-service");
    expect(classifyBranchArgv(["bun", "--watch", "run", owned.script, "gateway"])).toEqual({
      kind: "branch",
      entryIndex: 3,
    });
    expect(classifyBranchArgv(["bun", "run", "run", owned.script], { cwd: other.root })).toEqual({
      kind: "other",
    });
  });

  it.each([
    "dist/index.js",
    "dist/entry.js",
    "src/entry.ts",
    "src/index.ts",
    "scripts/run-node.mjs",
  ])("distinguishes Branch Agent from an unrelated package using %s", (entry) => {
    const owned = scriptFixture(entry);
    const other = scriptFixture(entry, "unrelated-service");
    expect(classifyBranchArgv(["node", entry], { cwd: owned.root })).toEqual({
      kind: "branch",
      entryIndex: 1,
    });
    expect(classifyBranchArgv(["node", entry], { cwd: other.root })).toEqual({
      kind: "other",
    });
    expect(
      classifyBranchArgv(["node", other.script, "gateway"], { command: "gateway" }).kind,
    ).toBe("other");
  });

  it("examines the runtime script, not eval source, option values or application arguments", () => {
    const owned = scriptFixture("dist/index.js");
    const other = scriptFixture("app.js", "unrelated-service");
    expect(
      classifyBranchArgv(["node", "--import", owned.script, other.script, owned.script]),
    ).toEqual({ kind: "other" });
    expect(classifyBranchArgv(["node", "--eval", "0", owned.script])).toEqual({
      kind: "other",
    });
    expect(classifyBranchArgv(["node", other.script, "/opt/branch/branch.mjs"])).toEqual({
      kind: "other",
    });
    expect(
      classifyBranchArgv(["node", "--import", "loader.js", "--no-warnings", owned.script]),
    ).toEqual({ kind: "branch", entryIndex: 4 });
    expect(classifyBranchArgv(["node", "--trace-uncaught", owned.script])).toEqual({
      kind: "branch",
      entryIndex: 2,
    });
    expect(classifyBranchArgv(["node", "--cpu-prof-name", owned.script, other.script])).toEqual({
      kind: "other",
    });
  });

  it("retains an explicit unknown when the working directory or script cannot be inspected", () => {
    const owned = scriptFixture("dist/index.js");
    expect(classifyBranchArgv(["node", "dist/index.js"])).toEqual({
      kind: "unclassified",
      cause: "cwd",
      reason: expect.stringContaining("working directory"),
    });
    fs.unlinkSync(owned.script);
    expect(classifyBranchArgv(["node", owned.script])).toEqual({
      kind: "unclassified",
      cause: "script",
      reason: expect.stringContaining("resolve script"),
    });
    expect(
      classifyBranchArgv(["node", owned.script, "gateway"], { command: "gateway" }).kind,
    ).toBe("unclassified");
  });

  it("preserves uncertainty for an absent or unreadable package identity", () => {
    const owned = scriptFixture("dist/index.js");
    const manifest = path.join(owned.root, "package.json");
    fs.writeFileSync(manifest, "{");
    expect(classifyBranchArgv(["node", owned.script])).toEqual({
      kind: "unclassified",
      cause: "package-identity",
      reason: expect.stringContaining("package identity"),
    });
    fs.unlinkSync(manifest);
    expect(classifyBranchArgv(["node", owned.script])).toEqual({
      kind: "unclassified",
      cause: "package-identity",
      reason: expect.stringContaining("package identity"),
    });
  });

  it("uses the same package facts for registered worker entrypoints", () => {
    const entry = "dist/infra/example.worker.js";
    const owned = scriptFixture(entry);
    const other = scriptFixture(entry, "unrelated-service");
    const additionalEntrypoints = [entry];
    expect(classifyBranchArgv(["node", owned.script], { additionalEntrypoints })).toEqual({
      kind: "branch",
      entryIndex: 1,
    });
    expect(classifyBranchArgv(["node", other.script], { additionalEntrypoints })).toEqual({
      kind: "other",
    });
  });
});
