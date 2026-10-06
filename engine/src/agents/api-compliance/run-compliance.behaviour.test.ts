import { mkdtemp, readFile, rm } from "node:fs/promises";
// Written by Branch from OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/integration/api_compliance/run_compliance.py (atlas AGENT-LOOP-0094). No upstream tests recorded; checks actual HTTP payloads and outcome/report semantics.
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestLlm, extractProvider, runSingleTest, runTest } from "./base.js";
import { reportCounts } from "./result.js";
import {
  DEFAULT_MODELS,
  PATTERNS,
  generateMarkdownReport,
  runComplianceTests,
  saveReport,
} from "./run-compliance.js";
const model = DEFAULT_MODELS["gpt-5.5"]!;
const unmatched = PATTERNS[0]!;
describe("malformed-history API compliance", () => {
  it("sends both malformed patterns unmodified with no retries", async () => {
    const bodies: Array<{ model: string; messages: unknown[]; tools: unknown[] }> = [];
    const server = createServer((req, res) => {
      let text = "";
      req.on("data", (chunk) => {
        text += String(chunk);
      });
      req.on("end", () => {
        bodies.push(JSON.parse(text));
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Invalid tool history", type: "invalid_request_error" },
          }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing port");
      const report = await runComplianceTests({
        modelIds: ["gpt-5.5"],
        create: () =>
          createTestLlm({
            LLM_API_KEY: "local-test-key",
            LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          }),
      });
      expect(bodies).toHaveLength(2);
      expect(bodies.map((b) => b.messages)).toEqual(
        PATTERNS.map((p) => p.buildMalformedMessages()),
      );
      expect(bodies[0]?.model).toBe("openai/gpt-5.5");
      expect(bodies[0]?.tools).toEqual([
        {
          type: "function",
          function: {
            name: "compliance_test_tool",
            description: "Execute a terminal command",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        },
      ]);
      expect(report.results.map((p) => p.results[0]?.response_type)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(report.results.map((p) => p.results[0]?.http_status)).toEqual([400, 400]);
      expect(reportCounts(report)).toEqual({
        total_tests: 2,
        total_rejected: 2,
        total_accepted: 0,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
  it("records acceptance without treating lenient providers as failures", async () => {
    const raw = { choices: [] };
    expect(await runTest(unmatched, model, "gpt-5.5", async () => raw)).toEqual({
      pattern_name: "unmatched_tool_use",
      model: model.model,
      model_id: "gpt-5.5",
      provider: "openai",
      response_type: "accepted",
      error_message: null,
      error_type: null,
      http_status: null,
      raw_response: raw,
      notes: "API accepted malformed input (unexpected)",
    });
  });
  it.each([
    ["TimeoutError", "timeout"],
    ["ConnectionError", "connection_error"],
    ["ValueError", "rejected"],
  ])("classifies %s", async (name, expected) => {
    const e = new Error("broken");
    e.name = name;
    expect(
      await runTest(unmatched, model, "gpt-5.5", async () => {
        throw e;
      }),
    ).toMatchObject({
      response_type: expected,
      error_message: "broken",
      error_type: name,
      http_status: null,
    });
  });
  it("extracts status from provider exception text", async () => {
    expect(
      await runTest(unmatched, model, "gpt-5.5", async () => {
        throw new Error("status_code: 422");
      }),
    ).toMatchObject({ http_status: 422, response_type: "rejected" });
  });
  it("records missing credentials as connection errors", async () => {
    expect(await runSingleTest(unmatched, model, "gpt-5.5", () => createTestLlm({}))).toMatchObject(
      {
        provider: "unknown",
        response_type: "connection_error",
        error_message: "Failed to create LLM: LLM_API_KEY environment variable not set",
      },
    );
  });
  it("preserves default models and rejects empty selections", async () => {
    expect(Object.keys(DEFAULT_MODELS)).toEqual(["claude-sonnet-4-5", "gpt-5.5", "gemini-3.1-pro"]);
    await expect(runComplianceTests({ patterns: ["missing"] })).rejects.toThrow(
      "No compliance tests found!",
    );
    await expect(runComplianceTests({ modelIds: ["missing"] })).rejects.toThrow(
      "No valid models found.",
    );
    expect(extractProvider("claude-gpt")).toBe("anthropic");
    expect(extractProvider("custom/model")).toBe("custom");
    expect(extractProvider("opaque")).toBe("unknown");
  });
  it("writes exact JSON and Markdown matrix outcomes", async () => {
    const report = await runComplianceTests({
      modelIds: ["gpt-5.5"],
      now: new Date("2026-10-06T01:02:03Z"),
      create: () => async () => ({ choices: [] }),
    });
    const dir = await mkdtemp(path.join(tmpdir(), "history-compliance-"));
    try {
      expect(report.test_run_id).toBe("compliance_20261006_010203");
      expect(JSON.parse(await readFile(await saveReport(report, dir), "utf8"))).toEqual(report);
      const md = await readFile(path.join(dir, "compliance_report.md"), "utf8");
      expect(md).toBe(generateMarkdownReport(report));
      expect(md).toContain("| Pattern | gpt |");
      expect(md).toContain("- **Total tests:** 2");
      expect(md).toContain("- **Accepted (lenient API behavior):** 2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
