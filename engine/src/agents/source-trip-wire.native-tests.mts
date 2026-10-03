import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import "./source-native-test-loader.mts";
import { TripWire } from "./source-trip-wire.ts";
import { resolveMaxProcessorRetries, DEFAULT_MAX_PROCESSOR_RETRIES, __resetProcessorRetryWarnings } from "./source-processor-retry-budget.ts";

const { resolveTripWireFinalize } = await import("./source-trip-wire-finalize.ts");
const { resolveGlobalSingleton } = await import("../shared/global-singleton.ts");

function loadNativeComposition() {
  const hooks = readFileSync(new URL("../plugins/hooks.ts", import.meta.url), "utf8");
  const dispatch = hooks.slice(hooks.indexOf("  async function runModifyingHook<"),
    hooks.indexOf("  /**\n   * Run a sequential claim hook"));
  const merge = hooks.slice(hooks.indexOf("  const mergeBeforeAgentFinalize ="), hooks.indexOf("  const handleHookError ="));
  const lifecycle = readFileSync(new URL("./harness/lifecycle-hook-helpers.ts", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  const logger = { debug: () => undefined, warn: () => undefined };
  const failures: unknown[] = [];
  const sandbox = { TripWire, resolveTripWireFinalize, resolveGlobalSingleton, createHash,
    registry: { hooks: [] as unknown[] }, logger, log: logger,
    isRecord: (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value),
    normalizeTrimmedString: (value: unknown) => typeof value === "string" ? value.trim() || undefined : undefined,
    createSubsystemLogger: () => logger, getGlobalHookRunner: () => undefined,
    buildAgentHookContext: (context: unknown) => context,
    getHooksForName: (registry: { hooks: unknown[] }) => registry.hooks,
    readClaimingHookAdmission: () => ({ assertCurrent: () => undefined }),
    modifyingHookTimeoutMsByHook: {}, awaitHook: (_hook: unknown, promise: Promise<unknown>) => promise,
    shouldCatchHookErrors: () => true, handleHookError: (failure: unknown) => { failures.push(failure); },
    HookIsolationError: class extends Error {},
    concatOptionalTextSegments: ({ left, right }: { left?: string; right?: string }) => [left, right].filter(Boolean).join("\n\n"),
  };
  const code = stripTypeScriptTypes(lifecycle + "\n" + merge + "\n" + dispatch +
    "\n({ runModifyingHook, mergeBeforeAgentFinalize, runAgentHarnessBeforeAgentFinalizeHook })", { mode: "strip" });
  const actual = runInNewContext(code, sandbox);
  const runner = { hasHooks: () => true, runBeforeAgentFinalize: (event: unknown, context: unknown) =>
    actual.runModifyingHook("before_agent_finalize", event, context, { mergeResults: actual.mergeBeforeAgentFinalize }) };
  return { sandbox, failures, finalize: (runId: string, lastAssistantMessage?: string) => actual.runAgentHarnessBeforeAgentFinalizeHook({
    event: { runId, sessionId: runId, stopHookActive: false, lastAssistantMessage }, ctx: { runId }, hookRunner: runner,
  }) };
}

test("TripWire preserves reason, retry flag, typed metadata and processor identity", () => {
  const metadata = { code: "needs-citation" };
  const error = new TripWire("Provide evidence", { retry: true, metadata }, "citation-check");
  assert.ok(error instanceof Error);
  assert.ok(error instanceof TripWire);
  assert.equal(error.message, "Provide evidence");
  assert.equal(error.options.metadata, metadata);
  assert.equal(error.processorId, "citation-check");
  assert.equal(error.options.retry, true);
});

test("TripWire defaults to stopping without a retry request", () => {
  const error = new TripWire("Stop");
  assert.deepEqual(error.options, {});
  assert.throws(() => resolveTripWireFinalize(error), (actual) => actual === error);
});

test("ordinary error is unchanged at the source adapter boundary", () => {
  const error = new Error("unrelated failure");
  assert.throws(() => resolveTripWireFinalize(error), (actual) => actual === error);
});

test("retry feedback uses the source cap and a processor-stable identity", () => {
  const one = resolveTripWireFinalize(new TripWire("feedback 1", { retry: true }, "processor"));
  const two = resolveTripWireFinalize(new TripWire("feedback 2", { retry: true }, "processor"));
  assert.equal(one.action, "revise");
  assert.equal(one.reason, "feedback 1");
  assert.equal(one.retry.instruction, "feedback 1");
  assert.equal(one.retry.maxAttempts, DEFAULT_MAX_PROCESSOR_RETRIES);
  assert.equal(one.retry.idempotencyKey, two.retry.idempotencyKey);
});

// Source retry-budget cases: explicit 0/above implicit cap and one-time/default-stack warnings.
test("no budget applies when no error processors exist", () => {
  assert.equal(resolveMaxProcessorRetries({ maxProcessorRetries: undefined, hasErrorProcessors: false }), undefined);
});
test("explicit zero disables processor retries", () => {
  assert.equal(resolveMaxProcessorRetries({ maxProcessorRetries: 0, hasErrorProcessors: true }), 0);
});
test("explicit retry budget above the implicit cap is preserved", () => {
  assert.equal(resolveMaxProcessorRetries({ maxProcessorRetries: 10, hasErrorProcessors: true }), 10);
});
test("configured processors warn once per agent when implicitly capped", () => {
  __resetProcessorRetryWarnings();
  const warnings: string[] = [];
  const config = { maxProcessorRetries: undefined, hasErrorProcessors: true,
    hasConfiguredErrorProcessors: true, agentId: "test", logger: { warn: (message: string) => { warnings.push(message); } } };
  assert.equal(resolveMaxProcessorRetries(config), 3);
  resolveMaxProcessorRetries(config);
  resolveMaxProcessorRetries({ ...config, agentId: "second" });
  assert.equal(warnings.length, 2);
});
test("framework default processors do not warn", () => {
  let warnings = 0;
  assert.equal(resolveMaxProcessorRetries({ maxProcessorRetries: undefined, hasErrorProcessors: true,
    logger: { warn: () => { warnings++; } } }), 3);
  assert.equal(warnings, 0);
});
test("explicitly configured processor retry budget does not warn", () => {
  let warnings = 0;
  resolveMaxProcessorRetries({ maxProcessorRetries: 8, hasErrorProcessors: true, hasConfiguredErrorProcessors: true,
    logger: { warn: () => { warnings++; } } });
  assert.equal(warnings, 0);
});

test("actual hook dispatcher and native harness cap changing processor feedback", async () => {
  const native = loadNativeComposition();
  let attempt = 0;
  native.sandbox.registry.hooks = [{ pluginId: "test", handler: () => {
    throw new TripWire(`Improve draft ${++attempt}`, { retry: true }, "stable-processor");
  } }];
  for (let index = 0; index < 3; index++) {
    const outcome = await native.finalize("source-tripwire-budget-native");
    assert.equal(outcome.action, "revise");
    assert.equal(outcome.reason, `Improve draft ${index + 1}`);
  }
  assert.equal((await native.finalize("source-tripwire-budget-native")).action, "continue");
  assert.equal(native.failures.length, 0);
});

test("actual hook and harness propagate hard TripWire abort while ordinary failures stay open", async () => {
  const native = loadNativeComposition();
  const error = new TripWire("Do not publish this draft", { metadata: { code: "reject" } }, "processor");
  native.sandbox.registry.hooks = [{ pluginId: "test", handler: () => { throw error; } }];
  const outcome = await native.finalize("source-tripwire-abort-native");
  assert.equal(outcome.action, "abort");
  assert.equal(outcome.error, error);
  native.sandbox.registry.hooks = [{ pluginId: "test", handler: () => { throw new Error("ordinary"); } }];
  assert.equal((await native.finalize("source-tripwire-ordinary-native")).action, "continue");
  assert.equal(native.failures.length, 1);
});

test("actual embedded abort branch suppresses terminal delivery and closes admission", () => {
  const native = readFileSync(new URL("./embedded-agent-runner/run/attempt-stream-prepare.ts", import.meta.url), "utf8");
  const start = native.indexOf("            if (outcome.action === \"abort\")");
  const end = native.indexOf("            if (outcome.action === \"finalize\")", start);
  assert.ok(start > 0 && end > start);
  const controller = new AbortController();
  const error = new TripWire("reject draft");
  const result = runInNewContext("(() => { let keepAdmissionClosed=false;" + native.slice(start, end) + "})()",
    { outcome: { action: "abort", error }, input: { runAbortController: controller } });
  assert.equal(result.suppressTerminalDelivery, true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, error);
});

test("actual native retry includes the rejected assistant response and processor feedback", async () => {
  const native = loadNativeComposition();
  native.sandbox.registry.hooks = [{ pluginId: "test", handler: () => {
    throw new TripWire("Cite the source", { retry: true }, "evidence");
  } }];
  const outcome = await native.finalize("source-tripwire-history-native", "The unsupported answer.");
  assert.equal(outcome.action, "revise");
  assert.ok(outcome.reason.includes("The unsupported answer."));
  assert.ok(outcome.reason.includes("Cite the source"));
});
