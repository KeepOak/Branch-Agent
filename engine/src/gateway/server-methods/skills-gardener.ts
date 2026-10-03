import {
  GATEWAY_CLIENT_CAPS,
  hasGatewayClientCap,
} from "../../../packages/gateway-protocol/src/client-info.js";
import {
  ErrorCodes,
  errorShape,
  validateSkillsGardenerActionParams,
  validateSkillsGardenerStatusParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  getSkillGardenerStatus,
  SKILL_LIFECYCLE_CURATION_RETIRED_MESSAGE,
} from "../../skills/workshop/gardener.js";
import type { GatewayRequestHandlers } from "./types.js";
import { defineValidatedGatewayHandler } from "./validation.js";

function retiredSkillGardenerAction(method: `skills.gardener.${"pin" | "restore" | "unpin"}`) {
  return defineValidatedGatewayHandler(method, validateSkillsGardenerActionParams, ({ respond }) => {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        formatErrorMessage(SKILL_LIFECYCLE_CURATION_RETIRED_MESSAGE),
      ),
    );
  });
}

export const skillsGardenerHandlers: GatewayRequestHandlers = {
  "skills.gardener.status": defineValidatedGatewayHandler(
    "skills.gardener.status",
    validateSkillsGardenerStatusParams,
    async ({ respond, context, client }) => {
      const status = await getSkillGardenerStatus({ config: context.getRuntimeConfig() });
      if (
        hasGatewayClientCap(client?.connect.caps, GATEWAY_CLIENT_CAPS.SKILL_GARDENER_LIVE_INVENTORY)
      ) {
        respond(true, status, undefined);
        return;
      }
      const { inventory: _inventory, ...legacyStatus } = status;
      const skills = status.skills.filter(
        (skill) => skill.createdAtMs !== null && skill.stateChangedAtMs !== null,
      );
      respond(
        true,
        { ...legacyStatus, skills, counts: { active: skills.length, stale: 0, archived: 0 } },
        undefined,
      );
    },
  ),
  "skills.gardener.pin": retiredSkillGardenerAction("skills.gardener.pin"),
  "skills.gardener.unpin": retiredSkillGardenerAction("skills.gardener.unpin"),
  "skills.gardener.restore": retiredSkillGardenerAction("skills.gardener.restore"),
};
