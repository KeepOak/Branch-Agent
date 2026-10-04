import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentWorkspaceAccess } from "../../agents/workspace-access.js";
import { createFixtureSkillEntry } from "../test-support/test-helpers.js";
import type { SkillBundle, SkillEntry } from "../types.js";
import { composeSkillBundleInvocation } from "./skill-bundle-invocation.js";

let root: string;
let release: (() => void) | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-bundle-invoke-"));
});
afterEach(() => {
  release?.();
  release = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});
function member(name: string, body = `INSTRUCTION ${name}`): SkillEntry {
  const entry = createFixtureSkillEntry(name);
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  entry.skill.filePath = path.join(directory, "SKILL.md");
  entry.skill.baseDir = directory;
  fs.writeFileSync(entry.skill.filePath, body);
  return entry;
}
function bundle(skills: string[]): SkillBundle {
  return {
    name: "Combo",
    slug: "combo",
    skills,
    sourceFilePath: path.join(root, "combo.yaml"),
    description: "combo",
    instruction: "Literal $ARGUMENTS",
  };
}
function invoke(
  skills: string[],
  entries: SkillEntry[],
  eligible = entries,
  options: { signal?: AbortSignal; assertCurrent?: () => void } = {},
) {
  return composeSkillBundleInvocation({
    bundle: bundle(skills),
    workspaceDir: root,
    entries,
    eligible,
    userInstruction: "User $ARGUMENTS",
    signal: options.signal,
    assertCurrent: options.assertCurrent ?? (() => {}),
  });
}
function bindReader(
  readInstructions: (file: string, options: { signal?: AbortSignal }) => Promise<string>,
) {
  release = registerAgentWorkspaceAccess(root, {
    bridge: {} as Parameters<typeof registerAgentWorkspaceAccess>[1]["bridge"],
    loadSkills: async () => ({
      entries: [],
      executionEntries: [],
      runtime: { platform: "linux", bins: [] },
    }),
    skillResources: {
      readInstructions,
      resolveExplicitSkill: async () => null,
      readSkillFiles: async () => [],
    },
  });
}

describe("whole admitted YAML member instructions", () => {
  it("renders members in order, deduplicates exact identifiers and retains literal user and bundle text", async () => {
    const entries = [member("one"), member("two")];
    const result = await invoke(["two", "one", "two", "ghost"], entries);
    expect(result).toMatchObject({ loaded: ["two", "one"], missing: ["ghost"], disabled: [] });
    expect(result?.message.indexOf("INSTRUCTION two")).toBeLessThan(
      result!.message.indexOf("INSTRUCTION one"),
    );
    expect(result?.message).toContain("Literal $ARGUMENTS");
    expect(result?.message).toContain("User $ARGUMENTS");
    expect(result?.message).toContain(entries[0]!.skill.baseDir);
    expect(result?.selections).toHaveLength(2);
  });
  it("never reads disabled members or path-shaped uninstalled targets", async () => {
    const entries = [member("allowed"), member("disabled", "FORBIDDEN CONTENT")];
    const forbidden = path.join(root, "other.txt");
    fs.writeFileSync(forbidden, "ARBITRARY FILE");
    const result = await invoke(["allowed", "disabled", forbidden], entries, [entries[0]!]);
    expect(result).toMatchObject({
      loaded: ["allowed"],
      disabled: ["disabled"],
      missing: [forbidden],
    });
    expect(result?.message).not.toContain("FORBIDDEN CONTENT");
    expect(result?.message).not.toContain("ARBITRARY FILE");
    expect(await invoke(["disabled"], entries, [])).toBeUndefined();
    expect((await invoke(["disabled"], entries))?.message).toContain("FORBIDDEN CONTENT");
  });
  it("has no eight-member or byte ceiling and reads current complete instructions", async () => {
    const entries = Array.from({ length: 11 }, (_, index) => member(`member-${index}`));
    const whole = `BEGIN${"x".repeat(300_000)}MIDDLE${"y".repeat(300_000)}END`;
    fs.writeFileSync(entries[0]!.skill.filePath, whole);
    const result = await invoke(
      entries.map((entry) => entry.skill.name),
      entries,
    );
    expect(result?.loaded).toHaveLength(11);
    expect(result?.message).toContain(whole);
  });
  it("uses delivered node/Library bytes and accurate non-filesystem location", async () => {
    const entry = createFixtureSkillEntry("delivered");
    entry.skill.filePath = "node://worker/skills/delivered/SKILL.md";
    entry.skill.readContent = "DELIVERED WHOLE";
    entry.skill.locationNote = "Read resources on node worker";
    const result = await invoke(["delivered"], [entry]);
    expect(result?.message).toContain("DELIVERED WHOLE");
    expect(result?.message).toContain("node worker");
    expect(result?.message).not.toContain("Resolve relative skill resources against");
  });
  it("reads only the exact native remote identity and forwards cancellation", async () => {
    const entry = member("remote");
    entry.skill.fileHost = "workspace";
    const controller = new AbortController();
    const reader = vi.fn(async () => "REMOTE WHOLE");
    bindReader(reader);
    expect(
      (await invoke(["remote"], [entry], [entry], { signal: controller.signal }))?.message,
    ).toContain("REMOTE WHOLE");
    expect(reader).toHaveBeenCalledWith(entry.skill.filePath, { signal: controller.signal });
  });
  it("fails closed for missing and revoked native remote readers, with no local fallback", async () => {
    const entry = member("remote", "NEVER LOCAL");
    entry.skill.fileHost = "workspace";
    release = registerAgentWorkspaceAccess(root, {
      bridge: {} as Parameters<typeof registerAgentWorkspaceAccess>[1]["bridge"],
      loadSkills: async () => ({
        entries: [],
        executionEntries: [],
        runtime: { platform: "linux", bins: [] },
      }),
    });
    await expect(invoke(["remote"], [entry])).rejects.toThrow("instructions are unavailable");
    release();
    release = undefined;
    await expect(invoke(["remote"], [entry])).rejects.toThrow("stopped or not ready");
  });
  it("does not misclassify cancellation or revoked admission as a missing member", async () => {
    const entry = member("remote");
    entry.skill.fileHost = "workspace";
    const controller = new AbortController();
    bindReader(async () => {
      controller.abort();
      return "STALE";
    });
    await expect(
      invoke(["remote"], [entry], [entry], { signal: controller.signal }),
    ).rejects.toThrow();
  });
  it("rejects a remote binding revoked during an awaited instruction read", async () => {
    const entry = member("remote");
    entry.skill.fileHost = "workspace";
    bindReader(async () => {
      release!();
      release = undefined;
      return "STALE BODY";
    });
    await expect(invoke(["remote"], [entry])).rejects.toThrow("stopped or not ready");
  });
  it("rechecks caller admission after an owning-host read", async () => {
    const entry = member("remote");
    entry.skill.fileHost = "workspace";
    let admitted = true;
    bindReader(async () => {
      admitted = false;
      return "REVOKED BODY";
    });
    await expect(
      invoke(["remote"], [entry], [entry], {
        assertCurrent: () => {
          if (!admitted) {
            throw new Error("Caller admission revoked");
          }
        },
      }),
    ).rejects.toThrow("Caller admission revoked");
  });
  it("records one ordinary source read failure as missing alongside usable members", async () => {
    const entries = [member("one"), member("gone")];
    fs.unlinkSync(entries[1]!.skill.filePath);
    expect(await invoke(["one", "gone"], entries)).toMatchObject({
      loaded: ["one"],
      missing: ["gone"],
    });
  });
});
