import { expect, it } from "vitest";
import { GatewayStateOwnerContentionError } from "../infra/gateway-state-owner.js";
import { DoctorUnreadableStateDatabaseError } from "../infra/state-repair-message.js";
import { BranchDatabaseSchemaPreflightError } from "../state/branch-database-preflight.messages.js";
import { formatCliFailureLines, formatCliJsonFailure } from "./failure-output.js";

it.each([
  new DoctorUnreadableStateDatabaseError("/state/branch.sqlite", "unreadable"),
  new BranchDatabaseSchemaPreflightError([
    { kind: "state", path: "/state/branch.sqlite", foundVersion: 20, supportedVersion: 19 },
  ]),
])("preserves the manual recovery when Doctor cannot repair $name", (error) => {
  const output = formatCliFailureLines({ title: "Command failed", error, env: {} }).join("\n");
  expect(output).toContain("restore");
  expect(output).toContain("backup");
  expect(output).not.toContain("For help, run `branch doctor`");
});

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
      kind === "nested"
        ? "[branch] Another Branch Agent process is using your data. Wait for it to finish before trying again."
        : "[branch] For help, run `branch doctor`.",
    ]);
    expect(error.message).toContain("Wait for the other Branch Agent process to finish, then retry.");
  },
);
