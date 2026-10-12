// The answer a model call gets while Lockdown is on: no provider is called, so nothing is spent.
import { makeZeroUsageSnapshot } from "../agents/usage.js";
import { LockdownError } from "../config/lockdown.js";
import type { AssistantMessage, AssistantMessageEventStreamContract, Model } from "./types.js";
import { createAssistantMessageEventStream } from "./utils/event-stream.js";

export function createLockdownErrorStream(model: Model): AssistantMessageEventStreamContract {
  const error = new LockdownError();
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: makeZeroUsageSnapshot(),
    stopReason: "error",
    errorMessage: error.message,
    timestamp: Date.now(),
  };
  const output = createAssistantMessageEventStream();
  output.push({ type: "error", reason: "error", error: message });
  output.end();
  return output;
}
