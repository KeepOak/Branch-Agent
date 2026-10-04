import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  validateDesktopRestartPrepareParams,
  validateDesktopRestartReceipt,
  validateDesktopRestartCancelParams,
  validateDesktopRestartIdentityParams,
  type DesktopRestartReceipt,
} from "../../../packages/gateway-protocol/src/schema/desktop-restart.js";
import {
  listActiveEmbeddedRunSessionKeys,
  resolveActiveEmbeddedRunSessionId,
} from "../../agents/embedded-agent-runner/active-run-projections.js";
import { resolveStateDir } from "../../config/paths.js";
import { listSessionPendingInputReceipts } from "../../config/sessions/session-accessor.sqlite-pending-input-receipts.js";
import { createGatewayActiveWorkSnapshot } from "../../infra/gateway-active-work.js";
import { deliveryContextFromSession } from "../../utils/delivery-context.read.js";
import { withDesktopRestartAdmission } from "../desktop-restart-admission.js";
import {
  holdDesktopRestartFence,
  releaseDesktopRestartFence,
  type DesktopRestartAttempt,
} from "../desktop-restart-fence.js";
import {
  DesktopRestartReceiptStore,
  type DesktopRestartRequester,
  type DesktopRestartRecord,
} from "../desktop-restart-receipts.js";
import {
  getGatewayLocalUserIngress,
  readGatewayLocalUserIngressFacts,
} from "../local-user-ingress.js";
import { getGatewayProcessInstanceId } from "../process-instance.js";
import { createGatewayServerActiveWorkInspectors } from "../server-active-work.js";
import { loadGatewaySessionEntryReadOnly } from "../session-utils-store.js";
import { readGatewayRequestMutationAuthority } from "./session-mutation-guards.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

export function captureDesktopRestartRequester(
  client: GatewayRequestHandlerOptions["client"],
): DesktopRestartRequester {
  // Use the canonical accepted ingress, preserving legacy owner auth factors.
  // Structural hints and credentials never become a device or a person.
  const facts = readGatewayLocalUserIngressFacts(getGatewayLocalUserIngress(client));
  const deviceProof = facts?.assurance?.find((proof) => proof.kind === "device-proof");
  if (
    !client ||
    client.internal?.syntheticClient ||
    client.connect.client.id !== "branch-control-ui" ||
    facts?.ingress.kind !== "gateway-client" ||
    facts.ingress.boundary !== "gateway.ws.authenticated-connect" ||
    facts.ingress.state !== "present" ||
    (deviceProof && deviceProof.rawEvidenceRef !== client.connect.device?.id)
  ) {
    throw new Error("Desktop restart requires a canonically accepted UI requester");
  }
  const deviceId = deviceProof?.rawEvidenceRef ?? null;
  const subject = {
    ingress: {
      kind: facts.ingress.kind,
      boundary: facts.ingress.boundary,
      state: facts.ingress.state,
      rawSourceRef: facts.ingress.rawSourceRef ?? null,
    },
    invoker:
      facts.invoker?.state === "present"
        ? {
            state: facts.invoker.state,
            kind: facts.invoker.kind,
            rawPrincipalRef: facts.invoker.rawPrincipalRef,
          }
        : facts.invoker?.state === "unknown"
          ? { state: "unknown" }
          : null,
  };
  return {
    profileId: client.authenticatedUserProfile?.profileId ?? null,
    userId: client.authenticatedUserId ?? null,
    deviceId,
    subject,
    clientId: client.pairedClientId ?? client.connect.client.id,
  };
}
function activeSessionKeys(options: GatewayRequestHandlerOptions): Set<string> {
  const keys = new Set(listActiveEmbeddedRunSessionKeys());
  for (const entry of options.context.chatAbortControllers.values()) {
    if (
      !entry.controller.signal.aborted &&
      entry.projectSessionActive !== false &&
      entry.isAbortable?.(entry) !== false
    )
      keys.add(entry.sessionKey);
  }
  for (const entry of options.context.chatQueuedTurns.values()) {
    if (!entry.controller.signal.aborted && entry.abortable !== false) keys.add(entry.sessionKey);
  }
  return keys;
}
function hasActiveTask(
  options: GatewayRequestHandlerOptions,
  canonicalKey: string,
  sessionId: string,
): boolean {
  for (const entry of options.context.chatAbortControllers.values()) {
    if (
      entry.sessionKey === canonicalKey &&
      entry.sessionId === sessionId &&
      !entry.controller.signal.aborted &&
      entry.projectSessionActive !== false &&
      entry.isAbortable?.(entry) !== false
    )
      return true;
  }
  // Covers embedded runs and auto-reply/native chat registry ownership too.
  return resolveActiveEmbeddedRunSessionId(canonicalKey) === sessionId;
}
function result(record: DesktopRestartRecord) {
  return {
    status: record.phase === "claimed" || record.phase === "canonical" ? "uncertain" : record.phase,
    ...(record.canonical?.runId
      ? { runId: record.canonical.runId }
      : record.runId
        ? { runId: record.runId }
        : {}),
  };
}
async function handle(
  options: GatewayRequestHandlerOptions,
  operation: "prepare" | "resume" | "cancel" | "observe",
) {
  const { params, context, respond } = options;
  const validator =
    operation === "prepare"
      ? validateDesktopRestartPrepareParams
      : operation === "cancel"
        ? validateDesktopRestartCancelParams
        : validateDesktopRestartReceipt;
  if (!validator(params)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "Invalid desktop restart parameters"),
    );
    return;
  }
  let store: DesktopRestartReceiptStore | undefined;
  let preparedFence: { attempt: DesktopRestartAttempt; actor: DesktopRestartRequester } | undefined;
  try {
    const assertCurrent = readGatewayRequestMutationAuthority(options).assertCurrent;
    assertCurrent();
    const actor = captureDesktopRestartRequester(options.client);
    store = new DesktopRestartReceiptStore(
      path.join(resolveStateDir(), "desktop-restart-receipts.sqlite"),
    );
    const attempt = {
      lifecycleGeneration: params.lifecycleGeneration as string,
      targetBuild: params.targetBuild as string,
    };
    if (operation === "cancel") {
      assertCurrent();
      if ("id" in params) store.get(params as DesktopRestartReceipt, actor);
      const pending = store.cancelAttempt(attempt, actor);
      if (pending) {
        respond(true, result(pending));
        return;
      }
      releaseDesktopRestartFence(attempt, actor);
      respond(true, { status: "cancelled" });
      return;
    }
    if (operation === "prepare") {
      store.prepareAttempt(attempt, actor);
      holdDesktopRestartFence(attempt, actor);
      preparedFence = { attempt, actor };
      let canonicalKey: string | undefined;
      let target: ReturnType<typeof loadGatewaySessionEntryReadOnly> | undefined;
      if ("sessionKey" in params) {
        target = loadGatewaySessionEntryReadOnly(
          params.sessionKey as string,
          undefined,
          context.getRuntimeConfig(),
        );
        if (!target.entry || target.entry.sessionId !== params.expectedSessionId)
          throw new Error("Desktop restart session changed");
        canonicalKey = target.canonicalKey;
      }
      const active = activeSessionKeys(options);
      const snapshot = createGatewayActiveWorkSnapshot(
        createGatewayServerActiveWorkInspectors(context),
      );
      const hasSelected =
        target?.entry && hasActiveTask(options, target.canonicalKey, target.entry.sessionId);
      const uncheckpointed =
        snapshot.counts.acpRuns +
        snapshot.counts.backgroundExecSessions +
        snapshot.counts.mediaRuns +
        snapshot.counts.cronRuns +
        snapshot.counts.sessionMutations +
        snapshot.counts.terminalPersistence +
        snapshot.counts.lifecycleWrites +
        snapshot.counts.terminalSessions +
        snapshot.counts.rootRequests +
        snapshot.counts.queueSize +
        snapshot.counts.pendingReplies +
        snapshot.counts.sessionAdmissions +
        snapshot.counts.queuedTurns;
      if (
        [...active].some((key) => key !== canonicalKey) ||
        (!hasSelected && !snapshot.idle) ||
        uncheckpointed > 0 ||
        (hasSelected && target?.entry?.incognito === true)
      ) {
        releaseDesktopRestartFence(attempt, actor);
        preparedFence = undefined;
        respond(true, { status: "deferred", ...attempt });
        return;
      }
      if (!target?.entry || !hasActiveTask(options, target.canonicalKey, target.entry.sessionId)) {
        store.cancelPreparedContinuation(attempt, actor);
        preparedFence = undefined;
        respond(true, { status: "idle", ...attempt });
        return;
      }
      const request = params as Parameters<DesktopRestartReceiptStore["prepare"]>[0];
      assertCurrent();
      const delivery = deliveryContextFromSession(target.entry);
      if (!hasActiveTask(options, target.canonicalKey, request.expectedSessionId)) {
        store.cancelPreparedContinuation(attempt, actor);
        preparedFence = undefined;
        respond(true, { status: "idle", ...attempt });
        return;
      }
      const sourceRunId =
        [...context.chatAbortControllers].find(
          ([, owner]) =>
            owner.sessionKey === target.canonicalKey &&
            owner.sessionId === request.expectedSessionId &&
            !owner.controller.signal.aborted,
        )?.[0] ??
        target.entry.lifecycleRunId ??
        null;
      const receipt = store.prepare(request, actor, {
        canonicalKey: target.canonicalKey,
        sourceRunId,
        lifecycleRevision: target.entry.lifecycleRevision ?? null,
        delivery: delivery ? { ...delivery } : null,
      });
      preparedFence = undefined;
      respond(true, receipt);
      return;
    }
    const receipt = params as DesktopRestartReceipt;
    let record = store.get(receipt, actor);
    if (operation === "observe") {
      if (process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256 !== receipt.targetBuild)
        throw new Error("Desktop restart candidate identity does not match the running engine");
      if (record.phase === "cancelled") {
        respond(true, { status: "cancelled" });
        return;
      }
      const target = loadGatewaySessionEntryReadOnly(
        record.binding.canonicalKey,
        undefined,
        context.getRuntimeConfig(),
      );
      if (
        !target.entry ||
        target.entry.sessionId !== receipt.expectedSessionId ||
        (target.entry.lifecycleRevision ?? null) !== record.binding.lifecycleRevision
      ) {
        respond(true, { status: "session-changed" });
        return;
      }
      const runId =
        record.canonical?.runId ?? (record.phase === "accepted" ? record.runId : undefined);
      if (runId) {
        if (
          target.entry.lastRunId === runId &&
          target.entry.status &&
          target.entry.status !== "running" &&
          target.entry.status !== "queued"
        ) {
          respond(true, { status: "completed", runId, outcome: target.entry.status });
          return;
        }
        // Admission witness is durable, matched to this exact original source.
        // It establishes canonical custody, never a new completion claim.
        respond(true, { status: "recovered", runId });
        return;
      }
      if (
        record.binding.sourceRunId &&
        target.entry.lastRunId === record.binding.sourceRunId &&
        target.entry.status &&
        target.entry.status !== "running" &&
        target.entry.status !== "queued"
      ) {
        respond(true, {
          status: "completed",
          runId: record.binding.sourceRunId,
          outcome: target.entry.status,
        });
        return;
      }
      respond(true, {
        status: "waiting",
        ...(target.entry.lifecycleRunId ? { runId: target.entry.lifecycleRunId } : {}),
      });
      return;
    }
    if (record.phase === "claimed") {
      const target = loadGatewaySessionEntryReadOnly(
        record.binding.canonicalKey,
        undefined,
        context.getRuntimeConfig(),
      );
      if (
        target.entry?.sessionId === receipt.expectedSessionId &&
        (target.entry.lifecycleRevision ?? null) === record.binding.lifecycleRevision
      ) {
        const runId = `desktop-restart:${receipt.id}`;
        const custody = listSessionPendingInputReceipts(
          {
            agentId: target.agentId,
            sessionId: receipt.expectedSessionId,
            sessionKey: target.canonicalKey,
            storePath: target.storePath,
          },
          { runIds: [runId] },
        );
        if (custody.some((item) => item.runId === runId && item.state === "consumed")) {
          assertCurrent();
          record = store.settle(receipt, actor, "accepted", runId);
        }
      }
    }
    if (record.phase !== "prepared") {
      respond(true, result(record));
      return;
    }
    if (process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256 !== receipt.targetBuild) {
      throw new Error("Desktop restart candidate identity does not match the running engine");
    }
    const target = loadGatewaySessionEntryReadOnly(
      record.binding.canonicalKey,
      undefined,
      context.getRuntimeConfig(),
    );
    if (
      !target.entry ||
      target.entry.sessionId !== receipt.expectedSessionId ||
      (target.entry.lifecycleRevision ?? null) !== record.binding.lifecycleRevision ||
      !isDeepStrictEqual(deliveryContextFromSession(target.entry) ?? null, record.binding.delivery)
    ) {
      assertCurrent();
      store.settle(receipt, actor, "cancelled");
      respond(true, { status: "session-changed" });
      return;
    }
    if (
      target.entry.status === "running" &&
      hasActiveTask(options, target.canonicalKey, receipt.expectedSessionId)
    ) {
      // A canonical recovery/producer already owns this task. Do not create a
      // second turn. Report its actual observed producer, never guess acceptance.
      const currentRunId =
        [...context.chatAbortControllers].find(
          ([, owner]) =>
            owner.sessionKey === target.canonicalKey &&
            owner.sessionId === receipt.expectedSessionId &&
            !owner.controller.signal.aborted,
        )?.[0] ?? target.entry.lifecycleRunId;
      respond(true, { status: "uncertain", ...(currentRunId ? { runId: currentRunId } : {}) });
      return;
    }
    if (
      target.entry.status !== "running" ||
      (record.binding.sourceRunId &&
        target.entry.lifecycleRunId &&
        record.binding.sourceRunId !== target.entry.lifecycleRunId)
    ) {
      assertCurrent();
      store.settle(receipt, actor, "cancelled");
      respond(true, { status: "cancelled" });
      return;
    }
    assertCurrent();
    record = store.claim(receipt, actor);
    // Re-enter the normal router with the SAME authenticated current client. This
    // rechecks agent scopes, command policy, profile/session access and admission.
    const { handleGatewayRequest } = await import("../server-methods.js");
    const sourceStore = store;
    let acknowledged = false;
    const agentRequest = {
      sessionKey: record.binding.canonicalKey,
      expectedExistingSessionId: receipt.expectedSessionId,
      expectedExistingSessionLifecycleRevision: record.binding.lifecycleRevision,
      idempotencyKey: `desktop-restart:${receipt.id}`,
      message: `${record.request.message}\n\nRestart checkpoint:\n${record.request.checkpoint}`,
      deliver: false,
    };
    await withDesktopRestartAdmission(
      agentRequest,
      {
        client: options.client!,
        receipt,
        canonicalKey: record.binding.canonicalKey,
        lifecycleRevision: record.binding.lifecycleRevision,
        assertCurrent,
        accept: (runId) => {
          sourceStore.settle(receipt, actor, "accepted", runId);
        },
      },
      () =>
        handleGatewayRequest({
          req: {
            type: "req",
            id: receipt.id,
            method: "agent",
            ...(actor.profileId ? { expectedProfileId: actor.profileId } : {}),
            params: agentRequest,
          },
          client: options.client,
          context,
          isWebchatConnect: options.isWebchatConnect,
          signal: options.signal,
          hasCurrentClientAuthority: options.hasCurrentClientAuthority,
          sessionMutationCommitGuard: assertCurrent,
          respond: (ok, payload, error) => {
            if (acknowledged) return;
            acknowledged = true;
            if (!ok) {
              respond(false, undefined, error);
              return;
            }
            const runId =
              payload &&
              typeof payload === "object" &&
              "runId" in payload &&
              typeof payload.runId === "string"
                ? payload.runId
                : undefined;
            const accepted = sourceStore.get(receipt, actor);
            if (accepted.phase !== "accepted") {
              respond(true, { status: "uncertain", ...(runId ? { runId } : {}) });
              return;
            }
            respond(true, {
              status: "accepted",
              ...(accepted.runId ? { runId: accepted.runId } : {}),
            });
          },
        }),
    );
    if (!acknowledged) respond(true, { status: "uncertain" });
  } catch (error) {
    if (preparedFence) releaseDesktopRestartFence(preparedFence.attempt, preparedFence.actor);
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        error instanceof Error ? error.message : String(error),
      ),
    );
  } finally {
    store?.close();
  }
}
export const desktopRestartHandlers: GatewayRequestHandlers = {
  "desktop.restart.identity": (options) => {
    if (!validateDesktopRestartIdentityParams(options.params)) {
      options.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Invalid desktop restart identity parameters"),
      );
      return;
    }
    try {
      readGatewayRequestMutationAuthority(options).assertCurrent();
      captureDesktopRestartRequester(options.client);
      const targetBuild = process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256;
      if (!targetBuild || targetBuild.length !== 64 || !/^[a-f0-9]{64}$/.test(targetBuild)) {
        options.respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Desktop engine build identity is unavailable", {
            retryable: false,
          }),
        );
        return;
      }
      options.respond(true, {
        targetBuild,
        processInstanceId: getGatewayProcessInstanceId(),
        pid: process.pid,
      });
    } catch (error) {
      options.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "desktop.restart.prepare": (options) => handle(options, "prepare"),
  "desktop.restart.observe": (options) => handle(options, "observe"),
  "desktop.restart.resume": (options) => handle(options, "resume"),
  "desktop.restart.cancel": (options) => handle(options, "cancel"),
};
