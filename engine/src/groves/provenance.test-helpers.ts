import { join } from "node:path";
import { openBranchStateDatabase } from "../state/branch-state-db.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import { parseGroveManifest } from "./schema.js";
import type { GroveBranchProfile, GroveSourceIdentity } from "./types.js";

export async function makeProvenancePlan(
  root: string,
  manifestValue: unknown,
  options: {
    workspace?: string;
    branchProfile?: GroveBranchProfile;
    packagePreflight?: NonNullable<
      Parameters<typeof buildGroveAddPlan>[0]["context"]
    >["packagePreflight"];
  } = {},
) {
  const parsed = parseGroveManifest(manifestValue);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  const source: GroveSourceIdentity = {
    kind: "package",
    name: "@acme/worker",
    version: "1.0.0",
    packageRoot: root,
    manifestPath: join(root, "branch.grove.json"),
    integrityKind: "artifact",
    integrity: "sha256:manifest",
    byteLength: 123,
  };
  const plan = await buildGroveAddPlan({
    manifest: parsed.manifest,
    branchProfile: options.branchProfile,
    source,
    context: {
      workspace: options.workspace ?? join(root, "workspace-worker"),
      ...(options.packagePreflight ? { packagePreflight: options.packagePreflight } : {}),
    },
  });
  return { root, plan };
}

export function stateEnv(root: string) {
  return { BRANCH_STATE_DIR: join(root, "state") };
}

export function readInstallRow(agentId: string, root: string) {
  return openBranchStateDatabase({ env: stateEnv(root) })
    .db.prepare(
      `SELECT agent_id, schema_version, grove_name, grove_version, integrity, plan_integrity,
              workspace, agent_config_digest, agent_owned_paths_json, status, added_at_ms
         FROM grove_installs
        WHERE agent_id = ?`,
    )
    .get(agentId) as
    | {
        agent_id: string;
        schema_version: string;
        grove_name: string;
        grove_version: string;
        integrity: string;
        plan_integrity: string;
        workspace: string;
        agent_config_digest: string;
        agent_owned_paths_json: string;
        status: string;
        added_at_ms: number | bigint;
      }
    | undefined;
}
