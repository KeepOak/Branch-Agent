import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasActiveCronJobsForAgent } from "../cron/active-jobs.js";
import { getSuspensionVisibleCronTaskRunCount } from "../cron/service/active-run-cancellation.js";
import { hasPendingCronSessionCleanupForAgent } from "../cron/service/locked.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import type { GroveMonitorCleanupGateway } from "./monitor-cleanup-contract.js";
import { parseGroveManifest } from "./schema.js";
import type { GroveSourceIdentity } from "./types.js";

async function verifyQuiescentFixture(agentId: string): Promise<void> {
  if (
    hasActiveCronJobsForAgent(agentId) ||
    getSuspensionVisibleCronTaskRunCount({ agentId }) > 0 ||
    hasPendingCronSessionCleanupForAgent(agentId)
  ) {
    throw new Error("Grove unit fixture unexpectedly owns pending scheduled work.");
  }
}

// These Grove unit fixtures have no scheduler or workers. The serving-owner integration
// suite proves cancellation, actual settlement, persistence, and lifecycle fencing.
export const quiescentGroveMonitorGateway: GroveMonitorCleanupGateway = {
  inspect: async () => [],
  quiesce: verifyQuiescentFixture,
  drain: verifyQuiescentFixture,
};

export async function buildGroveRemovalFixture(
  root: string,
  params: {
    id?: string;
    name?: string;
    withFile?: boolean;
    withBootstrap?: boolean;
    withCron?: boolean;
    withMcp?: boolean;
  } = {},
) {
  if (params.withFile) {
    await writeFile(join(root, "SOUL.md"), "managed\n", "utf8");
  }
  if (params.withBootstrap) {
    await writeFile(join(root, "BOOTSTRAP.md"), "managed\n", "utf8");
  }
  const parsed = parseGroveManifest({
    schemaVersion: 1,
    agent: { id: params.id ?? "worker", name: "Worker" },
    workspace: params.withFile ? { bootstrapFiles: { "SOUL.md": { source: "SOUL.md" } } } : {},
    mcpServers: params.withMcp
      ? {
          docs: {
            command: "uvx",
            args: ["docs-mcp"],
            env: { DOCS_TOKEN: "${DOCS_TOKEN}" },
          },
        }
      : {},
    cronJobs: params.withCron
      ? [
          {
            id: "daily-report",
            schedule: { cron: "0 9 * * *", timezone: "UTC" },
            session: "isolated",
            message: "Prepare report",
          },
        ]
      : [],
  });
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  const source: GroveSourceIdentity = {
    kind: "package",
    name: params.name ?? "@acme/worker",
    version: "1.0.0",
    packageRoot: root,
    manifestPath: join(root, "branch.grove.json"),
    integrityKind: "artifact",
    integrity: "sha256:manifest",
    byteLength: 100,
  };
  const plan = await buildGroveAddPlan({
    manifest: parsed.manifest,
    ...(params.withBootstrap
      ? {
          packageBootstrap: {
            sourcePath: "BOOTSTRAP.md",
            realPath: join(root, "BOOTSTRAP.md"),
            byteLength: Buffer.byteLength("managed\n"),
            digest: `sha256:${createHash("sha256").update("managed\n").digest("hex")}`,
          },
        }
      : {}),
    source,
    context: { workspace: join(root, `workspace-${params.id ?? "worker"}`) },
  });
  return { root, plan, env: { BRANCH_STATE_DIR: join(root, "state") } };
}
