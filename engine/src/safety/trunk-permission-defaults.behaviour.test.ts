import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  giveBackTrunkAccess,
  initialPermissionMode,
  NEW_ROOM_PERMISSION_MODE,
  NEW_TRUNK_PERMISSION_MODE,
  PERMISSION_MODE_WORDS,
  permissionModeWord,
  restoreTrunkFromBackup,
  type TrunkAccess,
} from "./trunk-permission-defaults.js";

const had: TrunkAccess = { mode: "full", toolsAllow: ["exec", "message"], schedulesEnabled: true };

function windowModeNames(): Record<string, string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "../../../window/src/composer/mode.ts");
  const text = fs.readFileSync(file, "utf8");
  const out: Record<string, string> = {};
  for (const match of text.matchAll(/engine: "([a-z-]+)",\s*name: "([^"]+)"/g)) {
    out[match[1] ?? ""] = match[2] ?? "";
  }
  return out;
}

describe("Trunk permission defaults (SAFETY-0214)", () => {
  it("R-0214: a restored Trunk comes back paused and look-only", () => {
    const restored = restoreTrunkFromBackup(had);
    expect(restored.paused).toBe(true);
    expect(restored.access).toEqual({ mode: "read-only", schedulesEnabled: false });
    expect(restored.heldAccess).toEqual(had);
  });

  it("G-1403: only the owner gives back what a restored Trunk had", () => {
    const restored = restoreTrunkFromBackup(had);
    expect(giveBackTrunkAccess(restored, { owner: false })).toEqual({
      paused: true,
      access: { mode: "read-only", schedulesEnabled: false },
    });
    expect(giveBackTrunkAccess(restored, { owner: true })).toEqual({ paused: false, access: had });
  });

  it("R-0215: new Trunks and rooms start on Ask first", () => {
    expect(NEW_TRUNK_PERMISSION_MODE).toBe("guarded");
    expect(NEW_ROOM_PERMISSION_MODE).toBe("guarded");
    expect(permissionModeWord(initialPermissionMode("trunk"))).toBe("Ask first");
    expect(permissionModeWord(initialPermissionMode("room"))).toBe("Ask first");
  });

  it("G-1404: the mode words match the window's mode names", () => {
    const names = windowModeNames();
    expect(Object.keys(names).toSorted()).toEqual(Object.keys(PERMISSION_MODE_WORDS).toSorted());
    for (const [mode, word] of Object.entries(PERMISSION_MODE_WORDS)) {
      expect(names[mode]).toBe(word);
    }
  });
});
