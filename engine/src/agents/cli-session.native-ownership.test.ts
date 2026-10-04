import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { buildPreparedCliRunContext } from "./cli-runner.test-helpers.js";
import { buildCliRunResult } from "./cli-runner/cli-run-settlement.js";
import {
  getCliSessionBinding,
  setCliSessionBinding,
  applyCliSessionBindingResult,
  shouldClearFailedCliSessionBinding,
} from "./cli-session.js";
import { resolveClaudeCliProjectDirForWorkspace } from "./command/claude-cli-project-dir.js";
const a = path.resolve("native-account-a");
const b = path.resolve("native-account-b");
describe("native Claude owner through actual session normalization and settlement", () => {
  it("persists owner through whitelist, JSON serialization, normalized read and reset-style copies", () => {
    const entry: SessionEntry = { sessionId: "branch", updatedAt: 0 };
    setCliSessionBinding(entry, "claude-cli", {
      sessionId: "native",
      nativeConfigDir: a,
      forceReuse: true,
      forkNextResume: true,
    });
    const reloaded = JSON.parse(JSON.stringify(entry)) as SessionEntry;
    expect(getCliSessionBinding(reloaded, "claude-cli")).toMatchObject({
      sessionId: "native",
      nativeConfigDir: a,
      forceReuse: true,
      forkNextResume: true,
    });
  });
  it.each([b, undefined])(
    "rejects removal or replacement of owner on same native handle",
    (nativeConfigDir) => {
      const entry: SessionEntry = { sessionId: "branch", updatedAt: 0 };
      setCliSessionBinding(entry, "claude-cli", { sessionId: "native", nativeConfigDir: a });
      expect(() =>
        setCliSessionBinding(entry, "claude-cli", { sessionId: "native", nativeConfigDir }),
      ).toThrow(/change.*owner/);
      expect(getCliSessionBinding(entry, "claude-cli")?.nativeConfigDir).toBe(a);
    },
  );
  it("failed native turns keep their captured owner instead of clearing into a new default", () => {
    const binding = { sessionId: "native", nativeConfigDir: a };
    const entry: SessionEntry = { sessionId: "branch", updatedAt: 0 };
    setCliSessionBinding(entry, "claude-cli", binding);
    expect(
      shouldClearFailedCliSessionBinding({
        binding,
        error: Object.assign(new Error("cancelled"), { name: "AbortError" }),
        bindingReplacedDuringRun: true,
      }),
    ).toBe(false);
    expect(
      applyCliSessionBindingResult(entry, "claude-cli", { clearCliSessionBinding: true }),
    ).toBe(false);
    expect(getCliSessionBinding(entry, "claude-cli")).toMatchObject(binding);
  });
  it("accepts normalized spellings of the same native directory without migrating accounts", () => {
    const entry: SessionEntry = { sessionId: "branch", updatedAt: 0 };
    setCliSessionBinding(entry, "claude-cli", { sessionId: "native", nativeConfigDir: a });
    const alias =
      process.platform === "win32" ? a.toUpperCase() : path.join(a, "..", path.basename(a));
    expect(() =>
      setCliSessionBinding(entry, "claude-cli", { sessionId: "native", nativeConfigDir: alias }),
    ).not.toThrow();
  });
  it("actual terminal result carries captured owner to session-store projection", () => {
    const context = buildPreparedCliRunContext();
    context.nativeConfigDir = a;
    const result = buildCliRunResult({
      context,
      output: { text: "done" },
      effectiveCliSessionId: "native",
      bindingFlushOk: true,
      usedHistoryPrompt: false,
      userTurnHandled: true,
      sessionBindingDisabled: false,
      preparedContextAgentMeta: {},
    });
    const entry: SessionEntry = { sessionId: "branch", updatedAt: 0 };
    applyCliSessionBindingResult(entry, "claude-cli", result.meta.agentMeta);
    expect(getCliSessionBinding(entry, "claude-cli")).toMatchObject({
      sessionId: "native",
      nativeConfigDir: a,
    });
  });
  it("projects transcript storage to selected config root, not ambient home", () => {
    const project = resolveClaudeCliProjectDirForWorkspace({
      workspaceDir: path.resolve("workspace"),
      homeDir: b,
      nativeConfigDir: a,
    });
    expect(project.startsWith(path.join(a, "projects") + path.sep)).toBe(true);
    expect(project.startsWith(path.join(b, ".claude"))).toBe(false);
  });
});
