import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

export function useLocalOverrideTestState() {
  let originalStateDir: string | undefined;
  let packageUpdateTestStateDir = "";

  beforeAll(async () => {
    originalStateDir = process.env.BRANCH_STATE_DIR;
    packageUpdateTestStateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "branch-package-update-state-"),
    );
    process.env.BRANCH_STATE_DIR = packageUpdateTestStateDir;
  });

  afterAll(async () => {
    if (originalStateDir === undefined) {
      delete process.env.BRANCH_STATE_DIR;
    } else {
      process.env.BRANCH_STATE_DIR = originalStateDir;
    }
    await fs.rm(packageUpdateTestStateDir, { recursive: true, force: true });
  });
}
export async function expectPathMissing(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    return;
  }
  throw new Error(`Expected missing path: ${filePath}`);
}
