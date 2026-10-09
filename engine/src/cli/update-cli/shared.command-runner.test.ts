import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTestDir } from "../../test-helpers/temp-dir.js";
import {
  ensureGitCheckout,
  parseUpdateTimeoutMs,
  resolveGlobalManager,
  resolveUpdateRoot,
  runUpdateStep,
  UpdatePreMutationError,
} from "./shared.js";

const runCommandWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("../../process/exec.js", () => ({
  runCommandWithTimeout,
}));

const successfulCommandResult = {
  stdout: "",
  stderr: "",
  code: 0,
  signal: null,
  killed: false,
  termination: "exit" as const,
};

describe("update CLI shared helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCommandWithTimeout.mockResolvedValue(successfulCommandResult);
  });

  it("accepts only complete positive integer timeout seconds", () => {
    for (const timeout of [
      "",
      "1.5",
      "10abc",
      "0x10",
      "0",
      "-1",
      "   ",
      String(Number.MAX_SAFE_INTEGER),
    ]) {
      expect(() => parseUpdateTimeoutMs(timeout)).toThrow(
        "--timeout must be a positive integer (seconds)",
      );
    }
    for (const [input, milliseconds] of [
      [" 10 ", 10_000],
      ["+10", 10_000],
      ["001", 1_000],
      [undefined, undefined],
    ] as const) {
      expect(parseUpdateTimeoutMs(input)).toBe(milliseconds);
    }
  });

  it("closes install stdin without approval and retains failed command diagnostics", async () => {
    runCommandWithTimeout.mockResolvedValueOnce({
      ...successfulCommandResult,
      code: 1,
      stdout: `${"x".repeat(10_000)}\nBuild type error`,
      stderr: "Command failed",
    });
    const onStepComplete = vi.fn();
    const result = await runUpdateStep({
      name: "package-install",
      argv: ["pnpm", "add", "-g", "branch@2.0.0"],
      timeoutMs: 1200,
      input: "",
      progress: { onStepComplete },
    });

    expect(result.stdoutTail).toContain("Build type error");
    expect(result.stdoutTail?.length).toBeLessThanOrEqual(8001); // includes the truncation marker
    expect(onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        stdoutTail: result.stdoutTail,
        stderrTail: "Command failed",
        exitCode: 1,
      }),
    );
    expect(runCommandWithTimeout).toHaveBeenCalledWith(
      ["pnpm", "add", "-g", "branch@2.0.0"],
      expect.objectContaining({ input: "" }),
    );
  });

  it.runIf(process.platform !== "win32")(
    "resolves update ownership from the lexical invocation path",
    async () => {
      await withTestDir({ prefix: "branch-update-root-" }, async (base) => {
        const storeRoot = path.join(base, "store", "branch");
        const packageRoot = path.join(base, "global", "v11", "install", "node_modules", "branch");
        await fs.mkdir(path.dirname(packageRoot), { recursive: true });
        await fs.mkdir(storeRoot, { recursive: true });
        await fs.writeFile(
          path.join(storeRoot, "package.json"),
          JSON.stringify({ name: "branch", version: "1.0.0" }),
          "utf8",
        );
        await fs.symlink(storeRoot, packageRoot, "dir");

        const previousArgv = [...process.argv];
        process.argv[1] = path.join(packageRoot, "branch.mjs");
        try {
          await expect(resolveUpdateRoot()).resolves.toBe(packageRoot);
        } finally {
          process.argv.splice(0, process.argv.length, ...previousArgv);
        }
      });
    },
  );

  it.each(["/shared", "/opt/homebrew-custom"])(
    "refuses unowned packages under %s without treating global npm as a Homebrew formula",
    async (prefix) => {
      const root = `${prefix}/lib/node_modules/branch`;
      vi.stubEnv("HOMEBREW_PREFIX", "/opt/homebrew-custom");
      try {
        runCommandWithTimeout.mockResolvedValue({
          ...successfulCommandResult,
          code: 1,
          stderr: "not owned",
        });

        const owner = resolveGlobalManager({
          root,
          installKind: "package",
          timeoutMs: 1_000,
        });
        await expect(owner).rejects.toBeInstanceOf(UpdatePreMutationError);
        await expect(owner).rejects.toMatchObject({
          name: "UpdatePreMutationError",
          reason: expect.stringMatching(/^(unmanaged-package-install|container-image-install)$/),
          failureFacts: [
            {
              check: "installation-inspection",
              code: "installation-unclassified",
              message: expect.stringMatching(/Installation ownership[\s\S]*retry branch update/),
            },
          ],
        });
        for (const detail of [
          `Root: ${root}`,
          "Git metadata: absent or unreadable",
          "node_modules layout: package under node_modules",
          "local node_modules absent or unreadable",
          "package.json name: missing or unreadable",
          "Service unit target: not inspected",
          "Inspected package-manager owners:",
          "npm root -g",
          "pnpm root -g",
          "prefix -g",
          "No package changes or Gateway restart were attempted.",
        ]) {
          await expect(owner).rejects.toMatchObject({ message: expect.stringContaining(detail) });
        }
        await expect(owner).rejects.not.toMatchObject({
          message: expect.stringContaining("managed by Homebrew"),
        });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "guides Homebrew-managed installations to use brew upgrade",
    async () => {
      await expect(
        resolveGlobalManager({
          root: "/opt/homebrew/Cellar/branch-cli/2026.9.2/libexec/lib/node_modules/branch",
          installKind: "package",
          timeoutMs: 1_000,
        }),
      ).rejects.toMatchObject({
        name: "UpdatePreMutationError",
        reason: "unmanaged-package-install",
        message:
          "This Branch Agent installation is managed by Homebrew. To update Branch Agent, run:\n\n  brew upgrade branch-cli\n\nThen restart the gateway:\n\n  branch gateway restart",
      });
    },
  );

  it("stops with the install message instead of cloning when no checkout exists", async () => {
    await withTestDir({ prefix: "branch-update-no-checkout-" }, async (base) => {
      const checkoutDir = path.join(base, "nested", "branch");

      await expect(ensureGitCheckout({ dir: checkoutDir })).rejects.toBeInstanceOf(
        UpdatePreMutationError,
      );
      await expect(ensureGitCheckout({ dir: checkoutDir })).rejects.toThrow(
        "Install Branch from the desktop app or the release page.",
      );
      expect(runCommandWithTimeout).not.toHaveBeenCalled();
      await expect(fs.stat(checkoutDir)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("stops the same way for an empty checkout directory", async () => {
    await withTestDir({ prefix: "branch-update-empty-checkout-" }, async (base) => {
      const checkoutDir = path.join(base, "branch");
      await fs.mkdir(checkoutDir);

      await expect(ensureGitCheckout({ dir: checkoutDir })).rejects.toThrow(
        "Install Branch from the desktop app or the release page.",
      );
      expect(runCommandWithTimeout).not.toHaveBeenCalled();
    });
  });

  it("refuses a non-empty directory that is not a Branch checkout", async () => {
    await withTestDir({ prefix: "branch-update-non-git-" }, async (base) => {
      const checkoutDir = path.join(base, "branch");
      await fs.mkdir(checkoutDir);
      await fs.writeFile(path.join(checkoutDir, "notes.txt"), "keep\n");

      await expect(ensureGitCheckout({ dir: checkoutDir })).rejects.toThrow(
        "BRANCH_GIT_DIR points at a non-git directory",
      );
      expect(runCommandWithTimeout).not.toHaveBeenCalled();
      await expect(fs.readFile(path.join(checkoutDir, "notes.txt"), "utf8")).resolves.toBe(
        "keep\n",
      );
    });
  });
});
