import { expect, it } from "vitest";
import { GatewayStateOwnerContentionError } from "../infra/gateway-state-owner.js";
import { formatCliFailureLines, formatCliJsonFailure } from "./failure-output.js";

it.each(["nested", "message-only"])(
  "preserves %s contention output and classifies the Doctor hint by error identity",
  (kind) => {
    const cause = new GatewayStateOwnerContentionError("/synthetic/branch.sqlite");
    const error =
      kind === "nested"
        ? new AggregateError(
            [new Error(`Task registry restore failed: ${cause.message}`, { cause })],
            cause.message,
          )
        : new Error(cause.message);
    expect(formatCliJsonFailure(error, { env: {} })).toEqual({
      ok: false,
      error: { type: "cli_error", message: error.message },
    });
    expect(formatCliFailureLines({ title: "The CLI command failed.", error, env: {} })).toEqual([
      "[branch] The CLI command failed.",
      `[branch] Reason: ${error.message}`,
      "[branch] Debug: set BRANCH_DEBUG=1 to include the stack trace.",
      ...(kind === "message-only" ? ["[branch] Try: branch doctor"] : []),
      "[branch] Help: branch --help",
    ]);
    expect(error.message).toContain("Wait for the other Branch Agent process to finish, then retry.");
  },
);
