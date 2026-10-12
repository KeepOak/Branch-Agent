import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";

const resolvePreferredBranchTmpDirMock = vi.hoisted(() => vi.fn());

vi.mock("./tmp-branch-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmp-branch-dir.js")>();
  return {
    ...actual,
    resolvePreferredBranchTmpDir: resolvePreferredBranchTmpDirMock,
  };
});

import { withInstallWorkspace } from "./install-source-utils.js";

describe("withInstallWorkspace private root", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  it.runIf(process.platform !== "win32").each(["missing", "writable"] as const)(
    "preserves parent temp root permissions when securing a %s Branch Agent temp root",
    async (state) => {
      const mockParentRoot = tempDirs.make("branch-chmod-test-");
      const mockBranchDir = path.join(mockParentRoot, "branch");

      if (state === "writable") {
        await fs.mkdir(mockBranchDir);
        await fs.chmod(mockBranchDir, 0o777);
      }
      await fs.chmod(mockParentRoot, 0o1777);
      const canonicalBranchDir = path.join(await fs.realpath(mockParentRoot), "branch");

      const { resolvePreferredBranchTmpDir } =
        await vi.importActual<typeof import("./tmp-branch-dir.js")>("./tmp-branch-dir.js");
      resolvePreferredBranchTmpDirMock.mockImplementation(() =>
        resolvePreferredBranchTmpDir({
          preferredDir: mockBranchDir,
          tmpdir: () => mockParentRoot,
          warn: vi.fn(),
        }),
      );

      let observedDir = "";
      const value = await withInstallWorkspace("branch-test-", async (tmpDir) => {
        observedDir = tmpDir;
        expect(path.dirname(tmpDir)).toBe(canonicalBranchDir);
        expect((await fs.stat(mockBranchDir)).mode & 0o7777).toBe(0o700);
        expect((await fs.stat(tmpDir)).mode & 0o7777).toBe(0o700);
        await fs.writeFile(path.join(tmpDir, "marker.txt"), "ok");
        return "done";
      });

      expect(value).toBe("done");

      await expect(
        fs.stat(observedDir).then(
          () => true,
          () => false,
        ),
      ).resolves.toBe(false);

      const privateRootStat = await fs.stat(mockBranchDir);
      expect(privateRootStat.mode & 0o7777).toBe(0o700);

      const parentStat = await fs.stat(mockParentRoot);
      expect(parentStat.mode & 0o7777).toBe(0o1777);
    },
  );
});
