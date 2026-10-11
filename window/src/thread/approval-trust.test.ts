import { describe, expect, it } from "vitest";
import {
  alwaysAllowCover,
  canDecideApprovals,
  CAREFUL_READ_CHARS,
  isCarefulCommand,
  isLocalHost,
  maskCommand,
  mixedAlphabets,
  reachedEnd,
} from "./approval-trust";

describe("approval trust helpers", () => {
  it("masks Bearer, token, key and password values in a command", () => {
    expect(maskCommand('curl -H "Authorization: Bearer wk-example-token-0042" https://example.test')).toBe(
      'curl -H "Authorization: Bearer ••••••••" https://example.test',
    );
    expect(maskCommand("tool --token=secret-value --other=ok")).toBe("tool --token=•••••••• --other=ok");
    expect(maskCommand("run key=abc123 password=hunter2")).toBe("run key=•••••••• password=••••••••");
  });

  it("flags a word that mixes Latin with Cyrillic or Greek letters", () => {
    expect(mixedAlphabets("curl https://data.example/export")).toBe(false);
    expect(mixedAlphabets("curl https://dаta.example/export")).toBe(true);
    expect(mixedAlphabets("echo hellο")).toBe(true);
  });

  it("words Always allow as the preview's covers line", () => {
    expect(alwaysAllowCover("Sapling")).toBe(
      "Always allow lets Sapling run this exact command without asking, until you take it back.",
    );
    expect(alwaysAllowCover("Sapling", "Nightly check run")).toBe(
      "Always allow lets Sapling run this exact command for Nightly check run without asking, until you take it back.",
    );
  });

  it("is careful only for a desktop command on this computer", () => {
    expect(isCarefulCommand({ desktop: true, host: "gateway" })).toBe(true);
    expect(isCarefulCommand({ desktop: true })).toBe(true);
    expect(isCarefulCommand({ desktop: true, plugin: true })).toBe(false);
    expect(isCarefulCommand({ desktop: true, host: "node-other" })).toBe(false);
    expect(isCarefulCommand({ desktop: false, host: "gateway" })).toBe(false);
    expect(isLocalHost(undefined)).toBe(true);
    expect(CAREFUL_READ_CHARS).toBe(120);
  });

  it("treats the command as read once the body is scrolled to its end", () => {
    expect(reachedEnd({ scrollTop: 0, clientHeight: 40, scrollHeight: 200 })).toBe(false);
    expect(reachedEnd({ scrollTop: 158, clientHeight: 40, scrollHeight: 200 })).toBe(true);
  });

  it("lets an owner decide and withholds the buttons when approval rights are missing", () => {
    expect(canDecideApprovals(undefined, undefined)).toBe(true);
    expect(canDecideApprovals(undefined, [])).toBe(true);
    expect(canDecideApprovals(undefined, ["operator.admin"])).toBe(true);
    expect(canDecideApprovals(undefined, ["operator.approvals"])).toBe(true);
    expect(canDecideApprovals(undefined, ["operator.read"])).toBe(false);
    expect(canDecideApprovals(false, ["operator.admin"])).toBe(false);
    expect(canDecideApprovals(true, ["operator.read"])).toBe(true);
  });
});
