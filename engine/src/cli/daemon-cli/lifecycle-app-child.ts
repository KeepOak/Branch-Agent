// Start/restart hooks that recover a missing or blocked service as an app child.
import { resolveGatewayService } from "../../daemon/service.js";
import { recoverInstalledLaunchAgent } from "./launchd-recovery.js";
import { appendGatewayLifecycleAudit } from "./lifecycle-audit.js";
import { resolveGatewayConfigPorts, resolveGatewayLifecycleContext } from "./lifecycle-context.js";
import {
  applyGatewayChildFallbackOnce,
  createGatewayChildFallbackOnce,
  noteReadyChildFallback,
} from "./service-start-fallback.js";
import { verifyGatewayStartReadiness } from "./start-health.js";

export function createDaemonStartAppChildHooks(params: {
  service: ReturnType<typeof resolveGatewayService>;
  expectedPort?: number;
}) {
  const recoverOnce = createGatewayChildFallbackOnce();
  const run = async (knownLoadState?: { status?: string }) =>
    recoverOnce.run({
      result: "started" as const,
      service: params.service,
      port: params.expectedPort ?? (await resolveGatewayConfigPorts()).fallback,
      knownLoadState,
    });
  return {
    recoverOnce,
    onNotLoaded: async () => {
      if (process.platform === "darwin") {
        const recovered = await recoverInstalledLaunchAgent({ result: "started" });
        if (recovered) {
          appendGatewayLifecycleAudit({
            action: "start",
            source: "cli",
            mode: "launchd-bootstrap",
          });
          return recovered;
        }
      }
      return await run({ status: "not-loaded" });
    },
    postStartCheck: async ({
      fail,
      warnings,
    }: {
      fail: (message: string, hints?: string[], result?: "still-starting") => void;
      warnings: string[];
    }) => {
      if (noteReadyChildFallback(recoverOnce, warnings)) {
        return;
      }
      let failed: string | undefined;
      let failedHints: string[] | undefined;
      let failedResult: "still-starting" | undefined;
      await verifyGatewayStartReadiness({
        service: params.service,
        expectedPort: params.expectedPort,
        resolveContext: () => resolveGatewayLifecycleContext(params.service),
        fail: (message, hints, result) => {
          failed = message;
          failedHints = hints;
          failedResult = result;
        },
        warnings,
      });
      if (!failed) {
        return;
      }
      await applyGatewayChildFallbackOnce({
        recoverOnce,
        recover: async () => await run(),
        failed,
        fail,
        hints: failedHints,
        code: failedResult,
        warnings,
      });
    },
    onStartFailed: async () => await run(),
  };
}
