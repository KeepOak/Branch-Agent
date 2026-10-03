import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSkillDiscoveryFileWatchPath, toWatchRoot } from "./refresh-watch-path.js";

const parseWindows = path.win32.parse;
const parsePosix = path.posix.parse;

afterEach(() => vi.restoreAllMocks());

describe("watch root normalization", () => {
  it.each([
    ["C:\\", "C:/"],
    ["C:////", "C:/"],
    ["\\\\server\\share\\", "//server/share/"],
    ["C:\\project\\skills\\", "C:/project/skills"],
  ])("preserves the absolute Windows filesystem boundary for %s", (input, expected) => {
    if (process.platform !== "win32") {
      vi.spyOn(path, "parse").mockImplementation(parseWindows);
    }
    const root = toWatchRoot(input);
    expect(root).toBe(expected);
    expect(path.win32.isAbsolute(root)).toBe(true);
    expect(parseWindows(root).root).toBe(parseWindows(input).root.replaceAll("\\", "/"));
  });

  it("preserves POSIX roots and trims ordinary directory separators", () => {
    if (process.platform === "win32") {
      vi.spyOn(path, "parse").mockImplementation(parsePosix);
    }
    expect(toWatchRoot("/")).toBe("/");
    expect(toWatchRoot("/tmp/skills///")).toBe("/tmp/skills");
  });
});

describe("native skill discovery filenames", () => {
  it.runIf(process.platform === "win32").each(["skill.md", "Skill.Md", "sKiLl.mD"])(
    "recognizes a Windows change to %s that the canonical loader can read",
    (name) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-skill-watch-case-"));
      try {
        fs.writeFileSync(path.join(dir, name), "updated skill instructions");
        // Qualify actual filesystem behavior, not a mocked process.platform.
        expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(
          "updated skill instructions",
        );
        expect(isSkillDiscoveryFileWatchPath(path.join(dir, name))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")("recognizes case variants of source-origin metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-skill-origin-case-"));
    try {
      const file = path.join(dir, "SOURCE-ORIGIN.JSON");
      fs.writeFileSync(file, "{}");
      expect(fs.readFileSync(path.join(dir, "source-origin.json"), "utf8")).toBe("{}");
      expect(isSkillDiscoveryFileWatchPath(file)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")("preserves exact-case discovery on POSIX", () => {
    expect(isSkillDiscoveryFileWatchPath("skills/skill.md")).toBe(false);
    expect(isSkillDiscoveryFileWatchPath("skills/SOURCE-ORIGIN.JSON")).toBe(false);
  });

  it("still ignores non-discovery files and generated dependency directories", () => {
    expect(isSkillDiscoveryFileWatchPath("skills/SKILL.md.backup")).toBe(false);
    expect(isSkillDiscoveryFileWatchPath("skills/README.md")).toBe(false);
    expect(isSkillDiscoveryFileWatchPath("node_modules/tool/SKILL.md")).toBe(false);
    expect(isSkillDiscoveryFileWatchPath("skills/.git/SKILL.md")).toBe(false);
    expect(isSkillDiscoveryFileWatchPath("skills/source-origin.json")).toBe(true);
  });
});
