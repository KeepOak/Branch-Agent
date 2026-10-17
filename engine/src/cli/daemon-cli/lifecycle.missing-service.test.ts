// Start and restart never install a missing gateway service. They supervise a
// child instead. This file reads the wiring without importing lifecycle.ts,
// which pulls a compiled-subprocess path that local Node cannot build.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const lifecycleSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "lifecycle.ts"),
  "utf8",
);

describe("missing or blocked gateway service wiring", () => {
  it("start and restart never install and recover a missing unit as a child", () => {
    expect(lifecycleSource).not.toContain("runDaemonInstall");
    expect(lifecycleSource).not.toContain("installMissingGatewayService");
    expect(lifecycleSource).not.toContain("missing-service-install");
    expect(lifecycleSource).toContain("MISSING_GATEWAY_SERVICE_REASON");
    expect(lifecycleSource).toContain("recoverFromFailedService");
    expect(lifecycleSource.match(/recoverFromFailedService/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
