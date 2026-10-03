import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRuntime } from "../../runtime.js";
import { withTestDir } from "../../test-helpers/temp-dir.js";
import { withEnvAsync } from "../../test-utils/env.js";
import {
  getMockCallOutput,
  spyRuntimeErrors,
  spyRuntimeJson,
  spyRuntimeLogs,
} from "../test-runtime-capture.js";
import type { DaemonStatus } from "./status.gather.js";

type StatusPrinter = typeof import("./status.print.js").printDaemonStatus;
const SYNTHETIC_TOKEN = "synthetic-status-install-hint-token";
const LOG_FILENAME = "status-install-hints.log";

const surfaces = [
  {
    kind: "missing-unit",
    name: "missing service unit",
    fact: "Service unit not found",
    command: "branch --profile work gateway install",
  },
  {
    kind: "config-mismatch",
    name: "CLI/service config-path mismatch",
    fact: "CLI and service are using different config paths",
    command: "branch gateway install --force",
  },
  {
    kind: "cached-label",
    name: "cached LaunchAgent label with missing plist",
    fact: "LaunchAgent label cached but plist missing",
    command: "branch gateway install",
  },
  {
    kind: "config-audit",
    name: "embedded-token service audit",
    fact: "embeds BRANCH_GATEWAY_TOKEN",
    command: "branch gateway install --force",
  },
  {
    kind: "version-mismatch",
    name: "installed service version mismatch",
    fact: "Gateway service version: 2026.4.15",
    command: "branch gateway install --force",
  },
] as const;
type StatusSurface = (typeof surfaces)[number]["kind"];

type InvocationEnvironment = (accountHome: string) => NodeJS.ProcessEnv;
const deniedInvocations = [
  {
    name: "Nix-managed installation",
    environment: () => ({ BRANCH_NIX_MODE: "1", BRANCH_SUPERVISOR_MODE: "external" }),
    reason: /Nix mode detected/,
    absent: /managed by an external supervisor/,
    recovery: /service install is disabled/,
    surfaces: [surfaces[0], surfaces[3], surfaces[4]],
  },
  {
    name: "global external supervision",
    environment: () => ({ BRANCH_SUPERVISOR_MODE: " EXTERNAL " }),
    reason: /managed by an external supervisor/,
    absent: /Nix mode detected/,
    recovery: /Use that supervisor to/,
    surfaces: [surfaces[1]],
  },
  {
    name: "relocated invoking HOME",
    environment: (accountHome: string) => ({ HOME: path.join(accountHome, "relocated") }),
    reason: /non-default state dir or config path/,
    absent: /Nix mode detected/,
    recovery: /HOME set to the OS account home/,
    surfaces: [surfaces[2]],
  },
] satisfies Array<{
  name: string;
  environment: InvocationEnvironment;
  reason: RegExp;
  absent: RegExp;
  recovery: RegExp;
  surfaces: readonly (typeof surfaces)[number][];
}>;

async function withStatusFixture(
  overrides: InvocationEnvironment,
  run: (accountHome: string, print: StatusPrinter) => Promise<void>,
): Promise<void> {
  await withTestDir({ prefix: "branch-status-install-hints-" }, async (accountHome) => {
    // The OS account stays fixed when the invocation changes HOME; following HOME
    // here would make a relocated installation falsely look canonical.
    vi.spyOn(os, "homedir").mockReturnValue(accountHome);
    vi.spyOn(os, "userInfo").mockImplementation(() => ({
      uid: 1000,
      gid: 1000,
      username: "status-fixture",
      homedir: accountHome,
      shell: "/bin/sh",
    }));
    const stateDir = path.join(accountHome, ".branch");
    await withEnvAsync(
      {
        HOME: accountHome,
        USERPROFILE: accountHome,
        HOMEDRIVE: undefined,
        HOMEPATH: undefined,
        BRANCH_HOME: undefined,
        BRANCH_STATE_DIR: stateDir,
        BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
        BRANCH_PROFILE: undefined,
        BRANCH_NIX_MODE: undefined,
        BRANCH_SUPERVISOR_MODE: undefined,
        BRANCH_SERVICE_REPAIR_POLICY: undefined,
        BRANCH_LAUNCHD_LABEL: undefined,
        BRANCH_SYSTEMD_UNIT: undefined,
        BRANCH_WINDOWS_TASK_NAME: undefined,
        BRANCH_CONTAINER: undefined,
        BRANCH_CONTAINER_HINT: undefined,
        BRANCH_LOG_PREFIX: undefined,
        ...overrides(accountHome),
      },
      async () => {
        // Import under the private home, keeping the real printer, hints, and
        // policy owners together without invoking status gathering or a manager.
        const { printDaemonStatus } = await import("./status.print.js");
        await run(accountHome, printDaemonStatus);
      },
    );
  });
}

async function createStatus(surface: StatusSurface, accountHome: string): Promise<DaemonStatus> {
  const status: DaemonStatus = {
    service: {
      label: "LaunchAgent",
      loaded: true,
      loadState: { status: "loaded" },
      loadedText: "loaded",
      notLoadedText: "not loaded",
      runtime: { status: "running", pid: 4242 },
    },
    logFile: path.join(accountHome, LOG_FILENAME),
    extraServices: [],
  };
  if (surface === "missing-unit") {
    status.service.loaded = false;
    status.service.loadState = { status: "not-loaded" };
    status.service.runtime = { status: "stopped", missingUnit: true };
  } else if (surface === "config-mismatch") {
    const serviceStateDir = path.join(accountHome, "service-state");
    const serviceConfigPath = path.join(serviceStateDir, "branch.json");
    status.config = {
      cli: {
        path: path.join(accountHome, ".branch", "branch.json"),
        exists: true,
        valid: true,
      },
      daemon: { path: serviceConfigPath, exists: true, valid: true },
      mismatch: true,
    };
    status.service.command = {
      programArguments: ["branch", "gateway"],
      environment: {
        HOME: accountHome,
        BRANCH_STATE_DIR: serviceStateDir,
        BRANCH_CONFIG_PATH: serviceConfigPath,
      },
    };
  } else if (surface === "cached-label") {
    status.service.runtime = { status: "running", pid: 4242, cachedLabel: true };
  } else if (surface === "version-mismatch") {
    status.cli = { version: "2026.6.35", entrypoint: path.join(accountHome, "bin/branch") };
    status.service.targetRole = "target";
    status.service.layout = {
      execStart: "/usr/bin/node /service-install/dist/index.js gateway",
      packageRoot: path.join(accountHome, "service-install"),
      packageVersion: "2026.4.15",
    };
    status.rpc = { ok: false, error: "protocol mismatch" };
  } else {
    const { auditGatewayServiceConfig } = await import("../../daemon/service-audit.js");
    const command = {
      programArguments: ["branch", "gateway"],
      environment: { BRANCH_GATEWAY_TOKEN: SYNTHETIC_TOKEN },
    };
    status.service.command = command;
    // The embedded-token finding is platform-independent. Windows avoids native
    // unit/plist inspection and PATH/runtime probes for this non-runtime binary.
    status.service.configAudit = await auditGatewayServiceConfig({
      platform: "win32",
      command,
      env: { HOME: accountHome },
    });
  }
  return status;
}

function humanOutput(): string {
  return stripVTControlCharacters(
    [
      getMockCallOutput(vi.mocked(defaultRuntime.log)),
      getMockCallOutput(vi.mocked(defaultRuntime.error)),
    ].join("\n"),
  );
}

function expectProblemAndLogs(output: string, fact: string): void {
  expect(output).toContain(fact);
  expect(output).toContain("File logs:");
  expect(output).toContain(LOG_FILENAME);
  expect(output).not.toContain(SYNTHETIC_TOKEN);
}

beforeEach(() => {
  // Cached-label fixtures model launchd, regardless of the test runner's host.
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  spyRuntimeLogs(defaultRuntime);
  spyRuntimeErrors(defaultRuntime);
  spyRuntimeJson(defaultRuntime);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it.each(
  deniedInvocations.flatMap(({ surfaces: invocationSurfaces, ...invocation }) =>
    invocationSurfaces.map((surface) => ({ ...invocation, surface })),
  ),
)(
  "retains $surface.name facts without unusable native advice under $name",
  async ({ environment, reason, absent, recovery, surface: { kind, fact } }) => {
    await withStatusFixture(environment, async (accountHome, print) => {
      const status = await createStatus(kind, accountHome);
      print(status, { json: false });

      const output = humanOutput();
      expectProblemAndLogs(output, fact);
      expect(output).toMatch(reason);
      expect(output).toMatch(recovery);
      expect(output).not.toMatch(absent);
      expect(output).not.toMatch(/\bgateway\s+install\b/);
      expect(output).not.toMatch(/\bdoctor\s+--repair\b/);
      expect(output).not.toMatch(/\bdoctor\s+--fix\b/);
      expect(output).not.toContain("launchctl bootout");
      expect(defaultRuntime.writeJson).not.toHaveBeenCalled();
    });
  },
);

describe("eligible status recovery", () => {
  it("directs version-manager runtime findings to Doctor before reinstall", async () => {
    await withStatusFixture(
      () => ({}),
      async (accountHome, print) => {
        const status = await createStatus("config-audit", accountHome);
        status.service.configAudit = {
          ok: false,
          issues: [
            {
              code: "gateway-runtime-node-version-manager",
              message:
                "Gateway service uses Node from a version manager; it can break after upgrades.",
              level: "recommended",
            },
          ],
        };
        print(status, { json: false });
        expect(humanOutput()).toContain("branch doctor");
        expect(humanOutput()).toContain("Reinstalling alone may select the same runtime");
        expect(humanOutput()).not.toContain("branch gateway install --force");
      },
    );
  });

  it("keeps remote service-install facts diagnostic-only even when installation is blocked", async () => {
    await withStatusFixture(
      () => ({ BRANCH_NIX_MODE: "1" }),
      async (accountHome, print) => {
        const status = await createStatus("version-mismatch", accountHome);
        status.service.targetRole = "diagnostic-only";
        status.rpc = { ok: false, url: "wss://remote.example:19443", error: "protocol mismatch" };
        print(status, { json: false });

        const output = humanOutput();
        expect(output).toContain("CLI version: 2026.6.35");
        expect(output).toContain("Gateway service version: 2026.4.15");
        expect(output).toContain("service-install");
        expect(output).toContain("The Gateway did not report its own version");
        expect(output).not.toMatch(/\breinstall\b/i);
        expect(output).not.toMatch(/\bgateway\s+install\b/);
        expect(output).not.toMatch(/\bdoctor\s+--fix\b/);
        expect(output).not.toContain("Nix mode detected");
      },
    );
  });

  it("gateway status keeps a missing diagnostic-only unit informational when its probe fails", async () => {
    await withStatusFixture(
      (accountHome) => ({ BRANCH_HOME: path.join(accountHome, "external") }),
      async (accountHome) => {
        const status = await createStatus("missing-unit", accountHome);
        status.service.targetRole = "diagnostic-only";
        status.rpc = { ok: false, error: "connect ECONNREFUSED" };
        const gather = await import("./status.gather.js");
        vi.spyOn(gather, "gatherDaemonStatus").mockResolvedValue(status);
        const { runDaemonStatus } = await import("./status.js");

        await runDaemonStatus({ rpc: {}, probe: true, requireRpc: false, json: false });

        const output = humanOutput();
        expect(output).toContain("Connectivity probe: failed");
        expect(defaultRuntime.log).toHaveBeenCalledWith(
          expect.stringContaining(
            "Native service is not installed; diagnostic only, not the probe target.",
          ),
        );
        expect(output).not.toContain("Service unit not found");
        expect(output).not.toContain("Gateway install blocked:");
        expect(output).not.toMatch(/\bgateway\s+install\b/);
        expect(defaultRuntime.error).toHaveBeenCalledWith(
          expect.stringContaining("connect ECONNREFUSED"),
        );
      },
    );
  });

  it.each(surfaces)(
    "keeps the canonical default installation's $name advice",
    async ({ kind, fact, command }) => {
      await withStatusFixture(
        (accountHome) =>
          kind === "missing-unit"
            ? {
                BRANCH_PROFILE: "work",
                BRANCH_STATE_DIR: path.join(accountHome, ".branch-work"),
                BRANCH_CONFIG_PATH: path.join(accountHome, ".branch-work", "branch.json"),
                BRANCH_LAUNCHD_LABEL: "ai.branch.work",
              }
            : kind === "config-audit"
              ? { BRANCH_SERVICE_REPAIR_POLICY: "external" }
              : {},
        async (accountHome, print) => {
          const status = await createStatus(kind, accountHome);
          if (kind === "cached-label") {
            status.service.targetRole = "diagnostic-only";
          }
          print(status, { json: false });

          const output = humanOutput();
          expectProblemAndLogs(output, fact);
          expect(output).toContain(command);
          expect(output).not.toContain("service management skipped");
          expect(output).not.toContain("managed by an external supervisor");
          if (kind === "version-mismatch") {
            expect(output).toContain("service-install");
            expect(output).toContain("The Gateway did not report its own version");
          }
          if (kind === "cached-label") {
            expect(output).toContain("launchctl bootout gui/$UID/ai.branch.gateway");
          }
        },
      );
    },
  );
});
