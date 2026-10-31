// @vitest-environment jsdom
// Issue 1814: plainError()'s path check missed relative paths (./config, notes/today.md) and absolute roots outside
// its list (/data, /nix, /System), so at Regular a file path still showed, most often in the lead a screen puts before
// the raw part ("Couldn't save notes/today.md: EACCES ..." kept "Couldn't save notes/today.md."). Advanced keeps the
// exact words.
import { afterEach, describe, expect, it } from "vitest";
import { looksRaw, plainError, plainText } from "./plain-error";

const PATH = /\/[\w.-]|[\w-]\/[\w.-]/;

afterEach(() => localStorage.clear());

describe("no file path at Regular (issue 1814)", () => {
  it.each([
    "Couldn't save notes/today.md: EACCES: permission denied",
    "Couldn't open ./config/app.json: ENOENT: no such file or directory",
    "Couldn't read ../shared/MEMORY.md: something went wrong",
    "Couldn't load /data/branch/state.db: SQLITE_BUSY",
    "Couldn't start /nix/store/abc-node/bin/node: spawn failed",
    "Couldn't open /System/Volumes/Data/x: EPERM",
    "Couldn't write /config.json: EROFS: read-only file system",
    "Couldn't open \u201c./notes/today.md\u201d: not found",
  ])("plainError(%j) keeps no path in its lead", (raw) => {
    const said = plainError(raw, true);
    expect(said).not.toMatch(PATH);
    expect(said.length).toBeGreaterThan(0);
  });

  it("names the failure after a lead that held a path", () => {
    expect(plainError("Couldn't save notes/today.md: EACCES: permission denied", true)).toBe(
      "Branch isn\u2019t allowed to do that here. Check the folder\u2019s permissions, then try again.",
    );
  });

  it.each([
    "Saved to ./notes/today.md",
    "Wrote src/shell/plain-error.ts",
    "Moved it to /data/branch/backups",
    "Opened /srv.json",
  ])("plainText(%j) shows no path", (words) => {
    expect(looksRaw(words)).toBe(true);
    expect(plainText(words, true)).not.toMatch(PATH);
  });

  it.each([
    "Turn sync on/off, then try again.",
    "Version 1.2.3 is ready.",
    "Couldn't change Lockdown. Try again.",
    "Read the guide at https://example.com/docs/setup.html first.",
    "Open localhost:3000/app.js to check it.",
  ])("plain words %j are not read as a path", (words) => {
    expect(looksRaw(words)).toBe(false);
  });

  it("Advanced keeps the exact words", () => {
    localStorage.setItem("branch.level", "advanced");
    const raw = "Couldn't save notes/today.md: EACCES: permission denied";
    expect(plainError(raw)).toBe(raw);
    expect(plainText("Saved to ./notes/today.md")).toBe("Saved to ./notes/today.md");
  });
});
