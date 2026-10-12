import { expect, it } from "vitest";
import { resolveSetupSecretInputString } from "./setup.secret-input.js";

it("throws with path context when env-template SecretRef cannot resolve", async () => {
  await expect(
    resolveSetupSecretInputString({
      config: { secrets: { providers: { default: { source: "env" } } } },
      value: "${BRANCH_GATEWAY_PASSWORD}",
      path: "gateway.auth.password",
      env: {},
    }),
  ).rejects.toThrow(
    'gateway.auth.password: failed to resolve SecretRef "env:default:BRANCH_GATEWAY_PASSWORD"',
  );
});
