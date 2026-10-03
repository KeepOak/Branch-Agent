import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { close, configureSqliteConnectionPragmas } = vi.hoisted(() => ({
  close: vi.fn(),
  configureSqliteConnectionPragmas: vi.fn(),
}));

vi.mock("branch/plugin-sdk/sqlite-worker-runtime", () => ({
  openNodeSqliteDatabase: vi.fn(() => ({ close })),
}));
vi.mock("branch/plugin-sdk/plugin-state-runtime", () => ({
  configureSqliteConnectionPragmas,
}));

import { createCanopySqliteKernel } from "./sqlite-store-kernel.js";

describe("Canopy SQLite policy", () => {
  beforeEach(() => {
    close.mockClear();
    configureSqliteConnectionPragmas.mockReset();
  });

  it("closes a newly opened database when filesystem policy refuses it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-policy-"));
    const dbPath = path.join(dir, "canopy.sqlite");
    configureSqliteConnectionPragmas.mockImplementation(() => {
      throw new Error("SSHFS is unsupported");
    });

    try {
      expect(() => createCanopySqliteKernel(dbPath)).toThrow(/SSHFS/);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
