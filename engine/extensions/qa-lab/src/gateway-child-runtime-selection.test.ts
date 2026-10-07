import { describe, expect, it } from "vitest";
import { buildQaForcedRuntimeEnvPatch } from "./gateway-child-env.js";

describe("configured QA runtime selection", () => {
  it("keeps Codex out of the force-runtime environment", () => {
    const runtimeEnvPatch = buildQaForcedRuntimeEnvPatch({
      forcedRuntime: "codex",
      runtimeSelection: "configured",
      providerMode: "live-frontier",
    });

    expect(runtimeEnvPatch).toMatchObject({
      BRANCH_BUILD_PRIVATE_QA: "1",
      BRANCH_CODEX_APP_SERVER_ARGS: expect.any(String),
    });
    expect(runtimeEnvPatch).not.toHaveProperty("BRANCH_QA_FORCE_RUNTIME");
  });
});
