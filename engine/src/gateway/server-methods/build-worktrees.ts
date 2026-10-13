// buildWorktrees.status: the last build worktree cleanup line for Settings › Computer & browser.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  readLastBuildWorktreeCleanup,
  resolveBuildWorktreeRoots,
} from "../build-worktree-cleanup.js";
import type { GatewayRequestHandlers } from "./types.js";

export const buildWorktreesHandlers: GatewayRequestHandlers = {
  "buildWorktrees.status": async ({ respond, context }) => {
    try {
      const enabled = resolveBuildWorktreeRoots(context.getRuntimeConfig()).length > 0;
      respond(true, { enabled, last: await readLastBuildWorktreeCleanup() }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(error)));
    }
  },
};
