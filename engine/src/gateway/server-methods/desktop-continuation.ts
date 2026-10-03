import path from "node:path";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { GATEWAY_OWNER_PROFILE_ID } from "../../../packages/gateway-protocol/src/schema/users.js";
import { resolveSessionStorePathCore } from "../../config/sessions/paths.js";
import { withSessionEntryReadOnlyInWorker } from "../../config/sessions/session-entry-read-runtime.js";
import { sessionMatchesExpectedTranscriptTurn } from "../../config/sessions/session-transcript-turn-state.js";
import { captureDeliveryQueueStateContext } from "../../infra/delivery-queue-state-context.js";
import {
  DesktopRestartContinuationStore,
  type DesktopContinuationReceipt,
} from "../../infra/desktop-restart-continuation.js";
import {
  enqueueSessionDelivery,
  withSessionDeliveryEnqueueAdmission,
} from "../../infra/session-delivery-queue-storage.js";
import type {
  SessionDeliveryRequesterBinding,
  SessionDeliveryRoute,
} from "../../infra/session-delivery-queue.records.js";
import { SessionDeliveryDeadLetteredError } from "../../infra/session-delivery-queue.records.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { resolveRuntimeServiceBuildId } from "../../version.js";
import { resolveGatewayOperatorRoleActor } from "../operator-role-policy.js";
import { isGatewayAdmin } from "../session-sharing.js";
import { loadGatewaySessionEntryReadOnly } from "../session-utils.js";
import { readGatewayRequestMutationAuthority } from "./session-mutation-guards.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseReceipt(value: unknown): DesktopContinuationReceipt {
  if (
    !record(value) ||
    ![value.id, value.sessionKey, value.expectedSessionId, value.targetBuild].every(text)
  ) {
    throw new Error("Invalid desktop continuation receipt");
  }
  return {
    id: value.id as string,
    sessionKey: value.sessionKey as string,
    expectedSessionId: value.expectedSessionId as string,
    targetBuild: value.targetBuild as string,
  };
}

const handle: GatewayRequestHandler = async (options) => {
  const { params, client, context, respond, req } = options;
  const { assertCurrent } = readGatewayRequestMutationAuthority(options);
  const assertOwner = (requester: string) => {
    assertCurrent();
    const actor = resolveGatewayOperatorRoleActor(client);
    // Reuse the Gateway's shared-secret owner identity; do not accept a renderer actor hint.
    if (
      requester !== GATEWAY_OWNER_PROFILE_ID ||
      !isGatewayAdmin(client) ||
      actor?.kind === "operator"
    ) {
      throw new Error("Desktop continuation requires the authenticated Gateway owner");
    }
  };
  try {
    assertOwner(GATEWAY_OWNER_PROFILE_ID);
    if (!record(params)) throw new Error("Invalid desktop continuation parameters");
    const queue = captureDeliveryQueueStateContext();
    // Carry request authority into the queue's existing before-COMMIT admission.
    // Checking only before the async enqueue would miss a revoked requester.
    const workerContext = {
      ...queue.workerContext,
      admission: {
        ...queue.workerContext.admission,
        assertCurrent: () => {
          assertOwner(GATEWAY_OWNER_PROFILE_ID);
          queue.workerContext.admission.assertCurrent();
        },
      },
    };
    const bindingIsCurrent = async (binding: SessionDeliveryRequesterBinding) => {
      assertOwner(GATEWAY_OWNER_PROFILE_ID);
      if (
        path.resolve(binding.storePath) !==
        path.resolve(
          resolveSessionStorePathCore(context.getRuntimeConfig().session?.store, {
            agentId: binding.agentId,
            env: queue.workerContext.environment,
          }),
        )
      )
        return false;
      return withSessionEntryReadOnlyInWorker(
        { ...binding, env: queue.workerContext.environment, hydrateSkillPromptRefs: false },
        () => {
          assertOwner(GATEWAY_OWNER_PROFILE_ID);
          queue.workerContext.admission.assertCurrent();
        },
        async (read) => {
          if (!read.ok) throw read.error;
          return sessionMatchesExpectedTranscriptTurn(
            read.value ? { entry: read.value } : undefined,
            {
              expectedSessionId: binding.sessionId,
              expectedLifecycleRevision: binding.lifecycleRevision,
            },
          );
        },
      );
    };
    const store = new DesktopRestartContinuationStore(
      path.join(queue.stateDir, "desktop-restart-continuations"),
      {
        assertOwner,
        bindingIsCurrent,
        currentBuild: resolveRuntimeServiceBuildId,
        enqueue: async (payload) => {
          assertOwner(GATEWAY_OWNER_PROFILE_ID);
          return enqueueSessionDelivery(payload, workerContext);
        },
      },
    );
    if (req.method === "desktop.continuation.prepare") {
      if (
        ![
          params.sessionKey,
          params.expectedSessionId,
          params.targetBuild,
          params.checkpoint,
          params.message,
        ].every(text)
      ) {
        throw new Error("Restart requires exact session, build, checkpoint and message");
      }
      const sessionKey = params.sessionKey as string;
      const target = loadGatewaySessionEntryReadOnly(
        sessionKey,
        { env: queue.workerContext.environment },
        context.getRuntimeConfig(),
      );
      if (
        !target.entry ||
        target.canonicalKey !== sessionKey ||
        target.entry.sessionId !== params.expectedSessionId
      ) {
        respond(true, { status: "session-changed" });
        return;
      }
      const binding: SessionDeliveryRequesterBinding = {
        agentId: target.agentId,
        sessionKey: target.canonicalKey,
        storePath: target.storePath,
        sessionId: target.entry.sessionId,
        lifecycleRevision: target.entry.lifecycleRevision ?? null,
      };
      const delivery = target.entry.delivery;
      const route: SessionDeliveryRoute =
        delivery?.kind === "external"
          ? {
              channel: delivery.context.channel ?? delivery.origin.provider ?? "",
              to: delivery.context.to ?? delivery.origin.to ?? "",
              accountId: delivery.context.accountId ?? delivery.origin.accountId,
              threadId:
                delivery.context.threadId === undefined
                  ? undefined
                  : String(delivery.context.threadId),
              chatType: delivery.origin.chatType ?? "direct",
            }
          : { channel: INTERNAL_MESSAGE_CHANNEL, to: target.canonicalKey, chatType: "direct" };
      const receipt = await withSessionDeliveryEnqueueAdmission(
        {
          kind: "agentTurn",
          sessionKey,
          message: params.message as string,
          messageId: "desktop-prepare",
          requesterBinding: binding,
        },
        workerContext,
        async (assertSessionCurrent) => {
          assertSessionCurrent();
          return store.prepare({
            sessionKey,
            expectedSessionId: binding.sessionId,
            targetBuild: params.targetBuild as string,
            checkpoint: params.checkpoint as string,
            message: params.message as string,
            requester: GATEWAY_OWNER_PROFILE_ID,
            binding,
            route,
          });
        },
      );
      respond(true, receipt);
      return;
    }
    const receipt = parseReceipt(params.receipt);
    const status =
      req.method === "desktop.continuation.cancel"
        ? await store.cancel(receipt, GATEWAY_OWNER_PROFILE_ID)
        : await store.resume(receipt, GATEWAY_OWNER_PROFILE_ID);
    respond(true, { status });
  } catch (error) {
    if (
      error instanceof SessionDeliveryDeadLetteredError ||
      (error instanceof Error && error.message === "session-changed")
    ) {
      respond(true, { status: "session-changed" });
      return;
    }
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error), {
        retryable: true,
      }),
    );
  }
};

export const desktopContinuationHandlers: GatewayRequestHandlers = {
  "desktop.continuation.prepare": handle,
  "desktop.continuation.resume": handle,
  "desktop.continuation.cancel": handle,
};
