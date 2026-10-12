// Policy tests cover register plugin behavior.
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runDoctorLintChecks,
  type HealthCheck,
  type HealthCheckContext,
  type HealthFinding,
  type HealthRepairContext,
  type BranchConfig,
} from "branch/plugin-sdk/health";
import { clearHealthChecksForTest } from "branch/plugin-sdk/plugin-test-runtime";
import { registerPolicyDoctorChecks } from "./register.js";

export let workspaceDir: string;

let originalBranchHome: string | undefined;

let originalBranchStateDir: string | undefined;

export function cfgWithPolicy(settings: Record<string, unknown> = {}): BranchConfig {
  return {
    plugins: {
      entries: {
        policy: {
          enabled: true,
          config: { enabled: true, ...settings },
        },
      },
    },
  };
}

type AuthoredAgents = NonNullable<BranchConfig["agents"]>;
type AuthoredEntry = NonNullable<AuthoredAgents["entries"]>[string];

export type RawLegacyDoctorConfig = Omit<BranchConfig, "agents"> & {
  agents?: Omit<AuthoredAgents, "entries"> & {
    entries?: Record<string, AuthoredEntry & { default?: boolean }>;
    list?: unknown[];
  };
};

type PolicyConfigFixture = RawLegacyDoctorConfig & Record<string, unknown>;

export function cfgWithPolicyOverrides(
  overrides: Partial<RawLegacyDoctorConfig> = {},
): PolicyConfigFixture {
  return { ...cfgWithPolicy(), ...overrides };
}

export function rawCfgWithPolicy(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...cfgWithPolicy(), ...overrides };
}

export async function writePolicyFixture(
  ...json: Parameters<typeof JSON.stringify>
): Promise<string> {
  const [policy] = json;
  const configPath = join(workspaceDir, "branch.jsonc");
  await fs.writeFile(configPath, "{}", "utf-8");
  await fs.writeFile(
    join(workspaceDir, "policy.jsonc"),
    typeof policy === "string" ? policy : JSON.stringify(...json),
    "utf-8",
  );
  return configPath;
}

export function ctx(configPath: string, cfg: BranchConfig = {}): HealthCheckContext {
  return {
    mode: "lint",
    runtime: {
      log() {},
      error() {},
      exit() {},
    },
    cfg,
    cwd: workspaceDir,
    configPath,
  };
}

export function repairCtx(configPath: string, cfg: BranchConfig = {}): HealthRepairContext {
  return {
    ...ctx(configPath, cfg),
    mode: "fix",
  };
}

export function registerChecks(): readonly HealthCheck[] {
  const checks: HealthCheck[] = [];
  registerPolicyDoctorChecks({
    registerHealthCheck(check) {
      checks.push(check);
    },
  });
  return checks;
}

export async function runPolicyChecks(checkCtx: HealthCheckContext): Promise<{
  readonly findings: readonly HealthFinding[];
}> {
  const checks = registerChecks();
  const findings: HealthFinding[] = [];
  for (const check of checks) {
    findings.push(...(check.detect === undefined ? [] : await check.detect(checkCtx)));
  }
  return { findings };
}

export async function runPolicyChecksFixture(
  policy: unknown,
  cfg: BranchConfig = cfgWithPolicy(),
) {
  return runPolicyChecks(ctx(await writePolicyFixture(policy), cfg));
}

export async function runPolicyDoctorLint(
  checkCtx: HealthCheckContext,
): Promise<Awaited<ReturnType<typeof runDoctorLintChecks>>> {
  return runDoctorLintChecks(checkCtx, { checks: registerChecks() });
}

export async function runDeniedChannelRepair(repairCheckCtx: HealthRepairContext) {
  const check = registerChecks().find((entry) => entry.id === "policy/channels-denied-provider");
  if (check?.detect === undefined || check.repair === undefined) {
    throw new Error("policy channel repair check was not registered");
  }
  const findings = await check.detect(repairCheckCtx);
  const result = await check.repair(repairCheckCtx, findings);
  const config = result.config ?? repairCheckCtx.cfg;
  const remainingFindings = await check.detect({ ...repairCheckCtx, cfg: config });
  return { ...result, config, remainingFindings };
}

export async function runPolicyRepairCheck(checkId: string, repairCheckCtx: HealthRepairContext) {
  const check = registerChecks().find((entry) => entry.id === checkId);
  if (check?.detect === undefined || check.repair === undefined) {
    throw new Error(`${checkId} repair check was not registered`);
  }
  const findings = await check.detect(repairCheckCtx);
  const result = await check.repair(repairCheckCtx, findings);
  const config = result.config ?? repairCheckCtx.cfg;
  const remainingFindings =
    repairCheckCtx.dryRun === true ? [] : await check.detect({ ...repairCheckCtx, cfg: config });
  return { ...result, findings, config, remainingFindings };
}

export const setupPolicyDoctorTest = async () => {
  clearHealthChecksForTest();
  originalBranchHome = process.env.BRANCH_HOME;
  originalBranchStateDir = process.env.BRANCH_STATE_DIR;
  workspaceDir = await fs.mkdtemp(join(tmpdir(), "policy-doctor-"));
  process.env.BRANCH_HOME = workspaceDir;
  delete process.env.BRANCH_STATE_DIR;
  await fs.mkdir(join(workspaceDir, ".branch"), { recursive: true });
  try {
    await fs.symlink(
      "../exec-approvals.json",
      join(workspaceDir, ".branch", "exec-approvals.json"),
    );
  } catch (err) {
    if (typeof err !== "object" || err === null || !("code" in err) || err.code !== "EPERM") {
      throw err;
    }
    await fs.rm(join(workspaceDir, ".branch"), { recursive: true, force: true });
    await fs.symlink(workspaceDir, join(workspaceDir, ".branch"), "junction");
  }
};

export const teardownPolicyDoctorTest = async () => {
  if (originalBranchHome === undefined) {
    delete process.env.BRANCH_HOME;
  } else {
    process.env.BRANCH_HOME = originalBranchHome;
  }
  if (originalBranchStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = originalBranchStateDir;
  }
  await fs.rm(workspaceDir, { recursive: true, force: true });
  clearHealthChecksForTest();
};
