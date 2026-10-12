import { DatabaseSync } from "node:sqlite";
import { expectDefined } from "@branch/normalization-core";
import { expect, it, vi } from "vitest";
import {
  awaitGateBeforeSettlement,
  createDeferred,
  withinTest,
} from "../../test/helpers/promise.js";
import { openBranchStateDatabase } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import * as stateWorker from "../state/branch-state-worker-store.js";
import { createGatewayMetadataCloseFixture } from "./server-close.metadata.test-support.js";
import { dispatchGatewayRequestInProcess } from "./server-in-process-dispatch.js";
import { createSyntheticPluginRuntimeClient } from "./server-plugin-runtime-client.js";

it("joins an accepted creation signal across the close prelude before closing its worker", async ({
  signal,
}) => {
  const fixture = await createGatewayMetadataCloseFixture("gateway-session-signal-close");
  const recordingEntered = createDeferred();
  const releaseRecording = createDeferred();
  const preludeEntered = createDeferred();
  let closing: Promise<void> | undefined;
  let creating: Promise<{ key: string }> | undefined;
  let restoreRecording: (() => void) | undefined;
  try {
    const port = await fixture.reservePort();
    const server = await fixture.start(port);
    const kernel = expectDefined(fixture.kernels.get(port), "Gateway kernel");
    const shared = openBranchStateDatabase({ env: fixture.state.env }).db;
    const run = stateWorker.runBranchStateWorkerOperation;
    const recording = vi
      .spyOn(stateWorker, "runBranchStateWorkerOperation")
      .mockImplementation((context, operation, options) =>
        run(
          context,
          (scope) =>
            operation({
              execute: async (command, executeOptions) => {
                if (command.type === "sessionState.record") {
                  recordingEntered.resolve();
                  await releaseRecording.promise;
                }
                return scope.execute(command, executeOptions);
              },
            }),
          options,
        ),
      );
    restoreRecording = () => recording.mockRestore();
    const dispatchOptions = {
      client: createSyntheticPluginRuntimeClient({
        sessionCreation: { via: "spawn", actor: { type: "agent", id: "main" } },
      }),
      context: kernel.gatewayRequestContext,
      methodRegistry: kernel.getAttachedGatewayMethodRegistry(),
    };
    const sessionKey = "agent:main:dashboard:accepted-close-signal";
    creating = dispatchGatewayRequestInProcess(
      "sessions.create",
      { key: sessionKey },
      dispatchOptions,
    );
    await withinTest(
      awaitGateBeforeSettlement(
        recordingEntered.promise,
        creating,
        "Session creation settled before recording its signal",
      ),
      signal,
    );
    kernel.requestEntryLifetime.signal.addEventListener("abort", () => preludeEntered.resolve(), {
      once: true,
    });
    let closed = false;
    closing = server.close({ reason: "gateway restarting", restartExpectedMs: 1_500 }).then(() => {
      closed = true;
    });
    await withinTest(
      awaitGateBeforeSettlement(
        preludeEntered.promise,
        closing,
        "Gateway closed before fencing request admission",
      ),
      signal,
    );
    await expect(
      dispatchGatewayRequestInProcess(
        "sessions.create",
        { key: "agent:main:dashboard:refused-close-signal" },
        dispatchOptions,
      ),
    ).rejects.toThrow("Gateway request entry is closed");
    expect(closed).toBe(false);
    expect(shared.isOpen).toBe(true);

    releaseRecording.resolve();
    await withinTest(Promise.all([creating, closing]), signal);
    expect(shared.isOpen).toBe(false);
    const database = new DatabaseSync(resolveBranchStateSqlitePath(fixture.state.env), {
      readOnly: true,
    });
    try {
      expect(
        database
          .prepare("SELECT session_key, kind FROM session_state_events WHERE kind = 'created'")
          .all(),
      ).toEqual([{ session_key: sessionKey, kind: "created" }]);
    } finally {
      database.close();
    }
  } finally {
    releaseRecording.resolve();
    await Promise.allSettled([creating, closing]);
    restoreRecording?.();
    await fixture.cleanup();
  }
});
