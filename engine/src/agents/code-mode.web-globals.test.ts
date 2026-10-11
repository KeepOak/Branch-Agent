import { expectDefined } from "@branch/normalization-core";
import { afterEach, describe, expect, it } from "vitest";
import { applyCodeModeCatalog } from "./code-mode.js";
import {
  createCodeModeHarness,
  pluginTool,
  resetCodeModeTestState,
  resultDetails,
} from "./code-mode.test-support.js";

afterEach(resetCodeModeTestState);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function codeModeTools(executor: "node" | "quickjs") {
  const { ctx, config, tools } = createCodeModeHarness({ codeMode: { executor } });
  const compacted = applyCodeModeCatalog({
    ...ctx,
    config,
    tools: [...tools, pluginTool("fake_lookup", "Lookup"), pluginTool("crypto", "Collide")],
  });
  return {
    exec: expectDefined(tools[0], "exec"),
    wait: expectDefined(tools[1], "wait"),
    description: compacted.tools[0]?.description ?? "",
  };
}

describe.each(["node", "quickjs"] as const)("Code Mode web globals (%s executor)", (executor) => {
  it("runs atob, btoa and crypto.randomUUID inside exec", async () => {
    const { exec, description } = codeModeTools(executor);
    const details = resultDetails(
      await exec.execute("web-globals", {
        code: `const id = crypto.randomUUID();
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          return {
            encoded: btoa("Branch"),
            decoded: atob("QnJhbmNo"),
            id,
            unique: id !== crypto.randomUUID(),
            bytes: bytes.length,
          };`,
      }),
    );
    expect(details).toMatchObject({
      status: "completed",
      value: { encoded: "QnJhbmNo", decoded: "Branch", unique: true, bytes: 16 },
    });
    expect((details.value as { id: string }).id).toMatch(UUID_V4);
    // A tool named crypto must not shadow the global.
    expect(description).toMatch(/- crypto_[a-f0-9]{8} /u);
    expect(description).toContain("`atob`/`btoa` handle base64");
  });

  it("keeps crypto working after a wait resume", async () => {
    const { exec, wait } = codeModeTools(executor);
    const first = resultDetails(
      await exec.execute("park", {
        code: 'text("parked"); await yield_control(); return crypto.randomUUID();',
      }),
    );
    expect(first).toMatchObject({ status: "waiting" });
    const resumed = resultDetails(await wait.execute("resume", { runId: first.runId }));
    expect(resumed).toMatchObject({ status: "completed" });
    expect(resumed.value).toMatch(UUID_V4);
  });

  it("lists available globals when a script uses a name Code Mode does not provide", async () => {
    const { exec } = codeModeTools(executor);
    const details = resultDetails(
      await exec.execute("missing", { code: "return automations.list();" }),
    );
    expect(details).toMatchObject({ status: "failed" });
    const error = String(details.error);
    expect(error).toContain("ReferenceError: automations is not defined");
    expect(error).toContain("`automations` is not a Code Mode global.");
    expect(error).toMatch(/Tool globals: .*fake_lookup/u);
    expect(error).toContain("atob, btoa, crypto");
  });
});
