import type { AcpRuntimeEvent } from "@branch/acp-core/runtime/types";
import { afterEach, describe, expect, it } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { createTestAdmittedRunContext } from "../../agents/admitted-run-context.test-support.js";
import { LockdownError } from "../../config/lockdown.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/runtime-snapshot.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import {
  AcpSessionManager,
  baseCfg,
  createRuntime,
  hoisted,
  installAcpSessionManagerTestLifecycle,
  installMutableAcpSessionMetaUpsert,
  readySessionMeta,
} from "./manager.test-helpers.js";

const sessionKey = "agent:codex:acp:lockdown-1";
const target = { cfg: baseCfg, sessionKey };

function fixture() {
  const runtime = createRuntime();
  const state = { currentMeta: readySessionMeta() };
  installMutableAcpSessionMetaUpsert(state);
  hoisted.requireAcpRuntimeBackendMock.mockReturnValue({ id: "acpx", runtime: runtime.runtime });
  hoisted.readAcpSessionEntryMock.mockImplementation(() => ({
    sessionKey,
    storeSessionKey: sessionKey,
    acp: state.currentMeta,
  }));
  const manager = new AcpSessionManager();
  const events: AcpRuntimeEvent[] = [];
  const startTurn = (requestId: string) =>
    manager.runTurn({
      ...target,
      provenance: "system",
      mode: "prompt",
      requestId,
      text: "edit the files",
      admittedRunContext: createTestAdmittedRunContext(requestId),
      onEvent: (event) => {
        events.push(event);
      },
    });
  return { ...runtime, manager, events, startTurn };
}

describe("ACP turns under Lockdown", () => {
  installAcpSessionManagerTestLifecycle();
  afterEach(() => clearRuntimeConfigSnapshot());

  it("refuses a channel message to an ACP-bound thread before the external harness starts", async () => {
    const f = fixture();
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
    await expect(f.startTurn("run-locked")).rejects.toBeInstanceOf(LockdownError);
    expect(f.runTurn).not.toHaveBeenCalled();
    expect(hoisted.requireAcpRuntimeBackendMock).not.toHaveBeenCalled();
  });

  it("cancels a turn that was already running when Lockdown turns on", async () => {
    await withStateDirEnv("branch-acp-lockdown-", async () => {
      const f = fixture();
      const entered = createDeferred();
      f.runTurn.mockImplementationOnce(async function* (input) {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) {
            resolve();
            return;
          }
          input.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield { type: "done", stopReason: "cancel" };
      });
      const turn = f.startTurn("run-active");
      await entered.promise;
      await f.manager.cancelAllTurns("Lockdown is on");
      await turn;
      expect(f.cancel).toHaveBeenCalledOnce();
      expect(f.cancel.mock.calls[0]?.[0].reason).toBe("Lockdown is on");
      expect(f.events.at(-1)).toMatchObject({ type: "done", status: "cancelled" });
    });
  });
});
