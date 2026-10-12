import { describe, expect, it } from "vitest";
import { readTextToolCall, stepFromTextToolCall } from "./text-tool-call";

const SPAWN = {
  name: "sessions_spawn",
  arguments: {
    visible: true,
    title: "model-smoke-test-2",
    sessionKey: "agent:<id>:model-smoke-test-2",
    message: "Starting new session for model smoke test",
  },
};
const SPAWN_JSON = JSON.stringify(SPAWN);

describe("readTextToolCall", () => {
  it("reads a whole-reply tool-call JSON object", () => {
    expect(readTextToolCall(`  ${SPAWN_JSON}  `)).toEqual(SPAWN);
  });

  it("reads the same object inside a json fence", () => {
    expect(readTextToolCall(`\`\`\`json\n${SPAWN_JSON}\n\`\`\`\n`)).toEqual(SPAWN);
    expect(readTextToolCall(`\`\`\`\n${JSON.stringify(SPAWN, null, 2)}\n\`\`\``)).toEqual(SPAWN);
  });

  it("returns null for a partial object and never throws", () => {
    const partial = '{"name": "sessions_spawn", "arguments": {';
    expect(readTextToolCall(partial)).toBeNull();
    expect(readTextToolCall("")).toBeNull();
    expect(readTextToolCall("[]")).toBeNull();
    expect(readTextToolCall("null")).toBeNull();
    expect(readTextToolCall('{"name":"sessions_spawn"}')).toBeNull();
    expect(readTextToolCall('{"arguments":{}}')).toBeNull();
    expect(readTextToolCall('{"name":"","arguments":{}}')).toBeNull();
    expect(readTextToolCall('{"name":"sessions_spawn","arguments":[]}')).toBeNull();
    expect(() => readTextToolCall("{".repeat(4000))).not.toThrow();
    expect(readTextToolCall("{".repeat(4000))).toBeNull();
  });

  it("leaves normal prose and JSON inside prose alone", () => {
    expect(readTextToolCall("Started a helper for the smoke test.")).toBeNull();
    expect(readTextToolCall(`Here is the call: ${SPAWN_JSON}`)).toBeNull();
    expect(readTextToolCall(`Use this:\n\n\`\`\`json\n${SPAWN_JSON}\n\`\`\`\n`)).toBeNull();
    expect(readTextToolCall(`{"note":"not a tool","arguments":{"title":"x"}}`)).toBeNull();
  });
});

describe("stepFromTextToolCall", () => {
  it("uses the existing plain words and the title as the detail", () => {
    const step = stepFromTextToolCall(SPAWN, "h:1:0");
    expect(step).toMatchObject({ kind: "step", tool: "sessions_spawn", title: "model-smoke-test-2", status: "ok" });
  });
});
