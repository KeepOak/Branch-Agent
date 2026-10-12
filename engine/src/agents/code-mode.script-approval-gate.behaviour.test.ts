// Behaviour tests for atlas SAFETY-0043: scripts go through the same approval gate.
// Upstream (NousResearch/hermes-agent tools/approval.py) is Python; Branch already
// routes Code Mode nested calls through the before-tool-call path, so these tests
// pin that behaviour under the owner's request ids.
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBlockedToolResult } from "./agent-tools.before-tool-call.js";
import { applyCodeModeCatalog } from "./code-mode.js";
import {
  createCodeModeHarness,
  pluginTool,
  resetCodeModeTestState,
  resultDetails,
} from "./code-mode.test-support.js";
import { jsonResult, type AnyAgentTool } from "./tools/common.js";

function bridge(targets: AnyAgentTool[]) {
  const h = createCodeModeHarness({ codeMode: { timeoutMs: 10_000 } });
  applyCodeModeCatalog({ ...h.ctx, tools: [...h.tools, ...targets] });
  return async (code: string) => resultDetails(await h.tools[0]!.execute("gate", { code }));
}

afterEach(async () => {
  await resetCodeModeTestState();
});

describe("Code Mode scripts and the approval gate", () => {
  it("G-1707: nested scripts are refused because exec and wait are never guest tools", async () => {
    const target = pluginTool("rows", "Return rows");
    target.execute = vi.fn(async () => jsonResult({ ok: true }));
    const result = await bridge([target])(
      "return [typeof exec, typeof wait, typeof rows].join('/');",
    );
    expect(result.status).toBe("completed");
    expect(result.value).toBe("undefined/undefined/function");
  });

  it("G-1707: code never supplies an owner yes; a blocked call stays blocked on retry", async () => {
    const target = pluginTool("send_money", "Move money");
    target.outputSchema = Type.Object({ id: Type.String() }, { additionalProperties: false });
    target.execute = vi.fn(async () => buildBlockedToolResult({ reason: "needs the owner" }));
    const result = await bridge([target])(
      "const out = []; for (const args of [{}, { approved: true, decision: 'allow-always' }]) {" +
        " try { await send_money(args); out.push('ran'); } catch (e) { out.push('blocked'); } }" +
        " return out.join(',');",
    );
    expect(result.status).toBe("completed");
    expect(result.value).toBe("blocked,blocked");
    expect(target.execute).toHaveBeenCalledTimes(2);
  });

  it("G-1558: runtime policy controls code execution; a policy block reaches the script as an error", async () => {
    const target = pluginTool("blocked", "Policy-controlled action");
    target.outputSchema = Type.Object({ id: Type.String() }, { additionalProperties: false });
    target.execute = vi.fn(async () =>
      buildBlockedToolResult({ reason: "blocked by runtime policy" }),
    );
    const result = await bridge([target])(
      "try { await blocked({}); return 'ran'; } catch (error) { return error.message; }",
    );
    expect(result.status).toBe("completed");
    expect(result.value).toContain("was blocked before execution: blocked by runtime policy");
  });
});
