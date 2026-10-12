import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { MAX_TIMER_TIMEOUT_MS } from "@branch/normalization-core/number-coercion";
import { resolveAgentTimeoutMs, DEFAULT_AGENT_TIMEOUT_MS } from "../agents/timeout.ts";

function actualSetupBudget(config: unknown, overrideMs?: number): Promise<{ timeoutMs: number }> {
  const source = readFileSync(new URL("./setup-inference-turn.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function runSetupInferenceTurn(");
  const end = source.indexOf("\n  try {\n    if (params.signal?.aborted)", start);
  assert.ok(start > 0 && end > start, "production setup admission prefix must exist");
  const prefix = source.slice(start, end).replace("export async function", "async function");
  const code = stripTypeScriptTypes(prefix + "\n  return shared;\n}\nrunSetupInferenceTurn", {
    mode: "strip",
  });
  const run = runInNewContext(code, {
    randomUUID,
    resolveAgentTimeoutMs,
    SETUP_INFERENCE_TEST_TIMEOUT_MS: 90_000,
    SETUP_INFERENCE_TEST_PROMPT: "fixture prompt",
    prepareSystemAgentRunAdmission: () => ({}),
    SessionManager: { inMemory: () => ({}) },
    setupInferenceLog: { warn: () => undefined },
  });
  return run({
    route: {
      agentId: "fixture",
      provider: "fixture",
      model: "fixture",
      runConfig: config,
      agentDir: "fixture",
    },
    deps: {
      createTempDir: async () => "fixture",
      ...(overrideMs !== undefined ? { timeoutMs: overrideMs } : {}),
    },
    requireExecutionOwner: false,
  });
}

test("actual setup admission inherits configured agent budget beyond a local-model cold load", async () => {
  const result = await actualSetupBudget({ agents: { defaults: { timeoutSeconds: 600 } } });
  assert.equal(result.timeoutMs, 600_000);
});

test("actual setup admission retains the existing default agent budget", async () => {
  assert.equal((await actualSetupBudget({})).timeoutMs, DEFAULT_AGENT_TIMEOUT_MS);
});

test("configured unlimited policy remains timer-safe rather than being cut to ninety seconds", async () => {
  const result = await actualSetupBudget({ agents: { defaults: { timeoutSeconds: 0 } } });
  assert.equal(result.timeoutMs, MAX_TIMER_TIMEOUT_MS);
});

test("explicit test or dependency timeout remains authoritative", async () => {
  const result = await actualSetupBudget({ agents: { defaults: { timeoutSeconds: 600 } } }, 12_345);
  assert.equal(result.timeoutMs, 12_345);
});

test("explicit zero uses the same native unlimited sentinel as other agent runs", async () => {
  assert.equal((await actualSetupBudget({}, 0)).timeoutMs, MAX_TIMER_TIMEOUT_MS);
});

test("invalid negative override falls back to the configured native budget", async () => {
  const result = await actualSetupBudget({ agents: { defaults: { timeoutSeconds: 600 } } }, -1);
  assert.equal(result.timeoutMs, 600_000);
});
