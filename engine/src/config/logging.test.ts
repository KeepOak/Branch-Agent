// Verifies logging config parsing and file path handling.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempDirSync } from "../test-helpers/temp-dir.js";

let formatConfigFilePath: typeof import("./logging.js").formatConfigFilePath;
let formatConfigUpdatedMessage: typeof import("./logging.js").formatConfigUpdatedMessage;
let logConfigUpdated: typeof import("./logging.js").logConfigUpdated;

beforeAll(async () => {
  ({ formatConfigFilePath, formatConfigUpdatedMessage, logConfigUpdated } =
    await import("./logging.js"));
});

beforeEach(() => {
  vi.stubEnv("BRANCH_CONFIG_PATH", "/tmp/branch-dev/branch.json");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config logging", () => {
  it("formats the live config path when no explicit path is provided", () => {
    expect(formatConfigFilePath()).toBe("/tmp/branch-dev/branch.json");
    vi.stubEnv("BRANCH_CONFIG_PATH", "/tmp/branch-next/branch.json");
    expect(formatConfigFilePath()).toBe("/tmp/branch-next/branch.json");
  });

  it("logs the live config path when no explicit path is provided", () => {
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    logConfigUpdated(runtime);
    expect(runtime.log).toHaveBeenCalledWith("Updated config: /tmp/branch-dev/branch.json");
    vi.stubEnv("BRANCH_CONFIG_PATH", "/tmp/branch-next/branch.json");
    logConfigUpdated(runtime);
    expect(runtime.log).toHaveBeenLastCalledWith(
      "Updated config: /tmp/branch-next/branch.json",
    );
  });

  it("formats backup as an indented detail when present", () => {
    withTempDirSync({ prefix: "branch-config-log-" }, (dir) => {
      const configPath = path.join(dir, "branch.json");
      const backupPath = `${configPath}.bak`;
      fs.writeFileSync(backupPath, "{}", "utf8");

      expect(
        formatConfigUpdatedMessage(configPath, {
          backupPath,
        }),
      ).toBe(`Updated config: ${configPath}\n  Backup: ${backupPath}`);
    });
  });
});
