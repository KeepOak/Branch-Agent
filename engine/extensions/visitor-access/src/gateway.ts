import { ErrorCodes, errorShape } from "branch/plugin-sdk/gateway-runtime";
import type { BranchPluginApi } from "../api.js";
import type { VisitorAccessConfig } from "./config.js";
import { VisitorAccessError } from "./errors.js";
import { describeVisitorPolicy } from "./policy-view.js";
import { visitorRuntimeStore } from "./runtime.js";

const NOT_READY = "Visitor invitations are managed by this Branch and are not ready yet.";

const METHODS = ["policy", "list", "invite", "revoke"] as const;

type VisitorMethod = (typeof METHODS)[number];

/**
 * Settings calls these instead of the agent tools. They never accept or return a
 * Cloudflare token: the Gateway's own visitor-access config holds that.
 */
export function registerVisitorGatewayMethods(
  api: BranchPluginApi,
  config: VisitorAccessConfig,
): void {
  const run = async (
    name: VisitorMethod,
    params: unknown,
    assertCurrent: () => void,
  ): Promise<unknown> => {
    if (name === "policy") {
      assertCurrent();
      return {
        policy: describeVisitorPolicy(config, api.runtime.config.current().gateway?.roles),
      };
    }
    const runtime = visitorRuntimeStore.tryGetRuntime();
    if (!runtime) {
      throw new VisitorAccessError(NOT_READY);
    }
    assertCurrent();
    if (name === "list") {
      return (await runtime.service.list(assertCurrent)).details;
    }
    if (name === "invite") {
      return (
        await runtime.service.invite(params, { assertCurrent, invitedVia: "settings" })
      ).details;
    }
    return (await runtime.service.revoke(params, assertCurrent)).details;
  };

  for (const name of METHODS) {
    api.registerGatewayMethod(
      `visitor.${name}`,
      async ({ params, respond, hasCurrentClientAuthority }) => {
        const assertCurrent = () => {
          if (hasCurrentClientAuthority && !hasCurrentClientAuthority()) {
            throw new VisitorAccessError("This request is no longer authorized.");
          }
        };
        try {
          respond(true, await run(name, params, assertCurrent));
        } catch (error) {
          const runtime = visitorRuntimeStore.tryGetRuntime();
          const message = runtime
            ? runtime.errorText(error)
            : error instanceof VisitorAccessError
              ? error.message
              : NOT_READY;
          respond(
            false,
            undefined,
            errorShape(
              runtime && error instanceof VisitorAccessError
                ? ErrorCodes.INVALID_REQUEST
                : ErrorCodes.UNAVAILABLE,
              message,
            ),
          );
        }
      },
      { scope: "operator.admin" },
    );
  }
}
