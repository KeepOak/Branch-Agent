import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import "./source-native-test-loader.mts";
import { TripWire } from "./source-trip-wire.ts";
const { resolveTripWireFinalize } = await import("./source-trip-wire-finalize.ts");
import { resolveGlobalSingleton } from "../shared/global-singleton.ts";
const { createWritingQualityFinalizeHook, validateWritingRewrite } = await import("./source-writing-quality.ts");

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
    takeHookMessageLoader: () => undefined,
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

const flagged = "Our team will leverage a robust and comprehensive solution to delve into the landscape of seamless paradigms. It is important to note that this approach fosters an innovative ecosystem.";

test("empty and plain technical drafts pass without requesting another model call", async () => {
  const hook = createWritingQualityFinalizeHook({ threshold: 0 });
  await hook({});
  await hook({ lastAssistantMessage: "The parser reads the file, checks its fields, and returns the result to the caller." });
});

test("invalid thresholds fail when the plugin registers its hook", () => {
  for (const threshold of [-1, 0.5, Infinity, NaN]) {
    assert.throws(() => createWritingQualityFinalizeHook({ threshold }), TypeError);
  }
});

test("actual native dispatcher preserves rejected draft and caps quality revisions", async () => {
  const native = loadNativeComposition();
  const hook = createWritingQualityFinalizeHook({ threshold: 0 });
  native.sandbox.registry.hooks = [{ pluginId: "writing", handler: hook }];
  for (let index = 0; index < 3; index++) {
    const outcome = await native.finalize("writing-native-retry", flagged);
    assert.equal(outcome.action, "revise");
    assert.ok(outcome.reason.includes(flagged));
    assert.ok(outcome.reason.includes("Preserve quoted material, code, tables, URLs, facts"));
  }
  assert.equal((await native.finalize("writing-native-retry", flagged)).action, "continue");
  assert.equal(native.failures.length, 0);
});

test("oversized draft stops actual native finalize rather than creating an endless retry", async () => {
  const native = loadNativeComposition();
  native.sandbox.registry.hooks = [{ pluginId: "writing", handler: createWritingQualityFinalizeHook() }];
  const outcome = await native.finalize("writing-native-limit", "word ".repeat(10001));
  assert.equal(outcome.action, "abort");
  assert.ok(outcome.error instanceof TripWire);
  assert.equal(outcome.error.options.retry, undefined);
  assert.equal(outcome.error.options.metadata.scannable, false);
});

test("registered options cannot be mutated to silently weaken the gate", async () => {
  const options = { threshold: 0 };
  const hook = createWritingQualityFinalizeHook(options);
  options.threshold = 999;
  await assert.rejects(hook({ lastAssistantMessage: flagged }), TripWire);
});

test("preservation validator rejects code edits independently from prose findings", () => {
  const original = "The parser reads the file and returns its fields.\n\n```js\nconst version = 1;\n```";
  const result = validateWritingRewrite(original, original.replace("version = 1", "version = 2"));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(finding => finding.code === "code-block-modified"));
});


test("unsupported scripts stop finalize without asserting authorship or consuming retries", async () => {
  const native = loadNativeComposition();
  native.sandbox.registry.hooks = [{ pluginId: "writing", handler: createWritingQualityFinalizeHook() }];
  const outcome = await native.finalize("writing-native-script", "这是一个中文文本。".repeat(30));
  assert.equal(outcome.action, "abort");
  assert.equal(outcome.error.options.retry, undefined);
  assert.equal(outcome.error.options.metadata.scannable, false);
});

test("actual embedded hard-stop branch closes admission and suppresses terminal delivery", async () => {
  const native = loadNativeComposition();
  native.sandbox.registry.hooks = [{ pluginId: "writing", handler: createWritingQualityFinalizeHook() }];
  const outcome = await native.finalize("writing-native-suppression", "word ".repeat(10001));
  const source = readFileSync(new URL("./embedded-agent-runner/run/attempt-stream-prepare.ts", import.meta.url), "utf8");
  const start = source.indexOf('            if (outcome.action === "abort")');
  const end = source.indexOf('            if (outcome.action === "finalize")', start);
  assert.ok(start > 0 && end > start);
  const controller = new AbortController();
  const result = runInNewContext("(() => { let keepAdmissionClosed=false;" + source.slice(start, end) + "})()",
    { outcome, input: { runAbortController: controller } });
  assert.equal(result.suppressTerminalDelivery, true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, outcome.error);
});
