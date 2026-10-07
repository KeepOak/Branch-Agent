import { describe, expect, it } from "vitest";
import { offPlan, planModelIds, planOrder } from "./codex-plan";
import { readModel, type ModelChoice } from "./model";

const codex = { id: "codex", source: "model" };
const model = (id: string, provider = "openai", agentRuntime: unknown = codex) => readModel({ id, provider, agentRuntime }) as ModelChoice;

describe("the ChatGPT plan's models (codex.models)", () => {
  it("reads each row's id and model, hidden rows included, and treats an empty list as unknown", () => {
    expect([...(planModelIds({ models: [{ id: "gpt-5.5", model: "gpt-5.5" }, { id: "openai/GPT-6-Sol", model: "gpt-6-sol", hidden: true }] }) ?? [])]).toEqual(["gpt-5.5", "gpt-6-sol"]);
    expect(planModelIds({ models: [] })).toBeNull();
    expect(planModelIds(undefined)).toBeNull();
  });

  it("greys only Codex-run OpenAI models missing from a known plan, and moves them last", () => {
    const plan = planModelIds({ models: [{ id: "gpt-5.5", model: "gpt-5.5" }] });
    const [on, off, api, claude] = [model("gpt-5.5"), model("gpt-6-sol"), model("gpt-6-sol", "openai", { id: "branch", source: "implicit" }), model("claude-opus-5", "anthropic")];
    expect([on, off, api, claude].map((m) => offPlan(m, plan))).toEqual([false, true, false, false]);
    expect(planOrder([off, on, api], plan).map((m) => m.ref)).toEqual(["openai/gpt-5.5", "openai/gpt-6-sol", "openai/gpt-6-sol"]);
    expect(planOrder([off, on], plan)[1]).toBe(off);
    expect(offPlan(off, null)).toBe(false);
    expect(planOrder([off, on], null)).toEqual([off, on]);
  });
});
