import { mergeProcessEnv } from "../../infra/process-env.js";

export function resolveChannelIngressStateEnv(stateDir?: string): NodeJS.ProcessEnv {
  return stateDir ? mergeProcessEnv([process.env, { BRANCH_STATE_DIR: stateDir }]) : process.env;
}
