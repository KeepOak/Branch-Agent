// Source behavior cases: tests/agent_server/test_unhandled_exception_error_id.py.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { createRequestErrorCorrelation } from "./request-error-correlation.ts";

test("source: unexpected failure exposes UUID4 hex correlation id", () => {
  const failure = createRequestErrorCorrelation("kaboom");
  assert.match(failure.details.error_id, /^[0-9a-f]{32}$/);
  assert.equal(failure.details.error_id[12], "4");
  assert.match(failure.details.error_id[16]!, /^[89ab]$/);
  assert.equal(failure.errorId, failure.details.error_id);
  assert.ok(failure.logMessage.includes(`[error_id=${failure.errorId}]`));
});
test("source: id is unique per failed request", () => {
  assert.notEqual(createRequestErrorCorrelation("kaboom").errorId, createRequestErrorCorrelation("kaboom").errorId);
});
test("correlation preserves existing message without adding exception or credential data", () => {
  const failure = createRequestErrorCorrelation("existing sanitized message");
  assert.deepEqual(Object.keys(failure.details), ["error_id"]);
  assert.ok(failure.logMessage.startsWith("request handler failed: existing sanitized message"));
});

// Execute the exact existing unexpected-handler catch body with dependency boundaries.
// Full WebSocket/auth/runtime imports remain a separate integration gate.
const source = fs.readFileSync(new URL("./server/ws-connection/authenticated-request-dispatch.ts", import.meta.url),"utf8");
const start = source.indexOf('          dispatchOutcome = "threw";');
const end = source.indexOf("        } finally {", start);
assert.ok(start > 0 && end > start);
const catchBody = source.slice(start,end).replace("correlation!.details", "correlation.details");
const runCatch = new Function("err", "classifyGatewayStaleInstall", "formatForLog", "createRequestErrorCorrelation", "logGateway", "respondWithAuthority", "errorShape", "ErrorCodes",
  'let dispatchOutcome; '+catchBody+';return dispatchOutcome;');
function dispatchFailure(stale?: unknown) {
  const logs: string[] = [];
  const responses: any[][] = [];
  const error = new Error("kaboom");
  const outcome = runCatch(error, () => stale, (e: Error) => e.message, createRequestErrorCorrelation,
    {error:(message: string) => logs.push(message)}, (...args: any[]) => responses.push(args),
    (code: string,message: string,opts: object) => ({code,message,...opts}), {UNAVAILABLE:"UNAVAILABLE"});
  return {logs,responses,outcome};
}
test("actual catch body carries same id in failure log and response details", () => {
  const result=dispatchFailure();
  assert.equal(result.outcome,"threw"); assert.equal(result.responses.length,1);
  const [ok,payload,error]=result.responses[0]!;
  assert.equal(ok,false); assert.equal(payload,undefined);
  assert.equal(error.code,"UNAVAILABLE"); assert.equal(error.message,"kaboom");
  assert.match(error.details.error_id,/^[0-9a-f]{32}$/);
  assert.equal(result.logs[0],`request handler failed: kaboom [error_id=${error.details.error_id}]`);
});
test("actual catch body assigns a new id for repeated failures", () => {
  assert.notEqual(dispatchFailure().responses[0]![2].details.error_id,dispatchFailure().responses[0]![2].details.error_id);
});
test("actual catch body preserves classified stale-install response unchanged", () => {
  const original={code:"STALE_INSTALL",message:"restart required",details:{reason:"installation-replaced"},retryable:true};
  const result=dispatchFailure({error:original});
  assert.equal(result.responses[0]![2],original);
  assert.deepEqual(result.logs,["request handler failed: kaboom"]);
});
