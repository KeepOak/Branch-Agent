import path from "node:path";
import { isDefaultStateDir, resolveStateDir } from "../../../config/paths.js";
import type { BranchConfig } from "../../../config/types.branch.js";
import { resolveUserPath } from "../../../utils.js";
import type { OnboardOptions } from "../../onboard-types.js";

export function resolveNonInteractiveWorkspaceDir(params: {
  opts: OnboardOptions;
  baseConfig: BranchConfig;
  defaultWorkspaceDir: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const implicitWorkspaceDir = isDefaultStateDir(env)
    ? params.defaultWorkspaceDir
    : path.join(resolveStateDir(env), "workspace");
  const raw = (
    params.opts.workspace?.trim() ||
    params.baseConfig.agents?.defaults?.workspace?.trim() ||
    env.BRANCH_WORKSPACE_DIR?.trim() ||
    implicitWorkspaceDir
  ).trim();
  return resolveUserPath(raw, env);
}
