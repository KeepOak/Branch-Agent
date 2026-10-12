import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisplayStringFormatter } from "./display-string.js";

function stubHome(home: string, branchHome = ""): void {
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", "");
  vi.stubEnv("BRANCH_HOME", branchHome);
}

describe("createDisplayStringFormatter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shortens whole-value homes and child paths without clipping sibling prefixes", () => {
    const home = path.resolve("test-home", "alice");
    stubHome(home);
    const displayString = createDisplayStringFormatter();

    expect(displayString(home)).toBe("~");
    expect(displayString(`${home}/project`)).toBe("~/project");
    expect(displayString(`${home}\\project`)).toBe("~\\project");
    expect(displayString(`Workspace: ${home}/project`)).toBe("Workspace: ~/project");
    expect(displayString(`${home}/one ${home}/two`)).toBe("~/one ~/two");
    expect(displayString(`Home: ${home},`)).toBe("Home: ~,");
    expect(displayString(`(${home})`)).toBe("(~)");
    expect(displayString(`${home}.`)).toBe("~.");

    expect(displayString(`${home}2/project`)).toBe(`${home}2/project`);
    expect(displayString(`${home},backup`)).toBe(`${home},backup`);
    expect(displayString(`${home} backup/project`)).toBe(`${home} backup/project`);
    expect(displayString(`${home}../project`)).toBe(`${home}../project`);
    expect(displayString(`prefix${home}/project`)).toBe(`prefix${home}/project`);
    expect(displayString(`/tmp${home}/project`)).toBe(`/tmp${home}/project`);
  });

  it("uses BRANCH_HOME as the display prefix", () => {
    const home = path.resolve("test-home", "alice");
    const branchHome = path.resolve("test-branch-home");
    stubHome(home, branchHome);
    const displayString = createDisplayStringFormatter();

    expect(displayString(branchHome)).toBe("$BRANCH_HOME");
    expect(displayString(`${branchHome}/state`)).toBe("$BRANCH_HOME/state");
    expect(displayString(`${branchHome}2/state`)).toBe(`${branchHome}2/state`);
  });

  it("keeps replacement syntax literal when expanding BRANCH_HOME", () => {
    const home = path.resolve("test-home", "$&user");
    stubHome(home, "~/state");
    const displayString = createDisplayStringFormatter();

    expect(displayString(path.join(home, "state", "project"))).toBe(
      `$BRANCH_HOME${path.sep}project`,
    );
  });

  it.skipIf(process.platform !== "win32")(
    "shortens real Windows home casing aliases inside table display text",
    () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "branch-home-display-"));
      try {
        const homeAlias = home.toUpperCase();
        expect(fs.statSync(homeAlias).isDirectory()).toBe(true);
        stubHome(home);
        const displayString = createDisplayStringFormatter();

        expect(displayString(`Workspace: ${homeAlias}\\project`)).toBe("Workspace: ~\\project");
        expect(displayString(`İ Workspace: ${homeAlias}\\project`)).toBe("İ Workspace: ~\\project");
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
