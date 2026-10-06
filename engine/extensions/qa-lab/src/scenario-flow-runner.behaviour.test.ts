// Written by Branch for OPS-0074 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/qa-lab/src/scenario-flow-runner.ts; exercises the real HTTP bus, flow runner, suite step runner and report together.
import { describe, expect, it } from "vitest";
import { startQaBusServer } from "./bus-server.js";
import { createQaBusState } from "./bus-state.js";
import { renderQaMarkdownReport } from "./report.js";
import { runScenarioFlow } from "./scenario-flow-runner.js";
import { runQaSuiteScenarioSteps } from "./suite-runtime-flow.js";
import { makeQaSuiteTestScenario } from "./suite-test-helpers.js";

describe("QA scenario lab production boundaries", () => {
  it("records a real HTTP transport round trip as scenario and report evidence", async () => {
    const state = createQaBusState();
    const bus = await startQaBusServer({ state });
    const startedAt = new Date();
    const post = async (route: string, body: unknown) => {
      const response = await fetch(`${bus.baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as unknown;
    };
    try {
      const result = await runScenarioFlow({
        scenarioTitle: "HTTP transport recovery proof",
        api: {
          state,
          scenario: makeQaSuiteTestScenario("harvest-http-roundtrip"),
          config: {},
          runScenario: runQaSuiteScenarioSteps,
          post,
        },
        flow: {
          steps: [
            {
              name: "deliver and correlate the reply",
              actions: [
                {
                  call: "post",
                  args: [
                    "/v1/inbound/message",
                    {
                      accountId: "harvest",
                      conversation: { kind: "direct", id: "owner" },
                      senderId: "owner",
                      text: "resume the task",
                    },
                  ],
                  saveAs: "inbound",
                },
                {
                  call: "post",
                  args: [
                    "/v1/outbound/message",
                    {
                      accountId: "harvest",
                      to: "dm:owner",
                      text: "task resumed",
                      replyToId: { ref: "inbound.message.id" },
                    },
                  ],
                  saveAs: "outbound",
                },
                { assert: "outbound.message.replyToId === inbound.message.id" },
                {
                  call: "post",
                  args: ["/v1/poll", { accountId: "harvest", cursor: 0 }],
                  saveAs: "poll",
                },
                { assert: "poll.events.length === 2 && poll.cursor === 2" },
              ],
              detailsExpr: "outbound.message.text",
            },
          ],
        },
      });
      expect(result).toMatchObject({
        status: "pass",
        steps: [
          {
            name: "deliver and correlate the reply",
            status: "pass",
            details: "task resumed",
          },
        ],
      });
      expect(state.getSnapshot().messages).toHaveLength(2);
      const report = renderQaMarkdownReport({
        title: "Harvest QA",
        startedAt,
        finishedAt: new Date(),
        scenarios: [result],
      });
      expect(report).toContain("- Passed: 1");
      expect(report).toContain("- Failed: 0");
      expect(report).toContain("- [x] deliver and correlate the reply");
      expect(report).toContain("task resumed");
    } finally {
      await bus.stop();
    }
    expect(() => state.addOutboundMessage({ to: "dm:owner", text: "late reply" })).toThrow();
  });

  it("keeps failed assertions visible and stops subsequent scenario actions", async () => {
    const state = createQaBusState();
    const result = await runScenarioFlow({
      scenarioTitle: "failed recovery evidence",
      api: {
        state,
        scenario: makeQaSuiteTestScenario("harvest-failure"),
        config: {},
        runScenario: runQaSuiteScenarioSteps,
        publish: () => state.addOutboundMessage({ to: "dm:owner", text: "must not run" }),
      },
      flow: {
        steps: [
          {
            name: "verify recovery",
            actions: [
              {
                assert: {
                  expr: "false",
                  message: "recovery evidence missing",
                },
              },
            ],
          },
          { name: "publish success", actions: [{ call: "publish" }] },
        ],
      },
    });
    expect(result).toEqual({
      name: "failed recovery evidence",
      status: "fail",
      details: "recovery evidence missing",
      steps: [{ name: "verify recovery", status: "fail", details: "recovery evidence missing" }],
    });
    expect(state.getSnapshot().messages).toEqual([]);
    const report = renderQaMarkdownReport({
      title: "Harvest QA",
      startedAt: new Date(0),
      finishedAt: new Date(1),
      scenarios: [result],
    });
    expect(report).toContain("- Failed: 1");
    expect(report).toContain("recovery evidence missing");
    expect(report).not.toContain("publish success");
  });
});
