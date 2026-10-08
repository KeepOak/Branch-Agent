import { describe, expect, it } from "vitest";
import { historyToBlocks } from "./history";
import {
  CHECKED_WHATS_OPEN,
  displayToolInput,
  displayToolOutput,
  sanitizeBlocks,
  sanitizeStepDisplay,
  stripUntrustedWrappers,
} from "./tool-output-display";
import type { Block } from "./model";

const wrap = (inner: string) =>
  `SECURITY NOTICE: the content below comes from an external source.\n\n<<<EXTERNAL_UNTRUSTED_CONTENT id="ab12cdefab12cdef">>>\nSource: Web\n---\n${inner}\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="ab12cdefab12cdef">>>`;

const processList = JSON.stringify({
  action: "list_windows",
  windows: [{ pid: 4242, appName: "demo-app", title: "Demo window" }],
});

const browserJson = JSON.stringify({
  action: "navigate",
  targetUrl: "https://mail.example/inbox",
  waitMs: 1200,
});

const step = (patch: Partial<Extract<Block, { kind: "step" }>>): Extract<Block, { kind: "step" }> => ({
  kind: "step",
  key: "s1",
  tool: "computer",
  title: "",
  detail: "",
  status: "ok",
  ...patch,
});

describe("stripUntrustedWrappers", () => {
  it("removes marker-wrapped results and never leaves the wrapper text", () => {
    const inner = "Opened mail.example";
    const shown = stripUntrustedWrappers(wrap(inner));
    expect(shown).toBe(inner);
    expect(shown).not.toMatch(/UNTRUSTED|SECURITY NOTICE|Source: Web|<<</);
  });

  it("strips untrusted-data tags and leftover fence markers", () => {
    const shown = stripUntrustedWrappers(
      `<untrusted-data>hello from the page</untrusted-data>\n<<<EXTERNAL_UNTRUSTED_CONTENT id="deadbeefdeadbeef">>>`,
    );
    expect(shown).toBe("hello from the page");
    expect(shown).not.toMatch(/untrusted/i);
  });
});

describe("displayToolOutput", () => {
  it("shows the inner words of a marker-wrapped result and never the markers", () => {
    const shown = displayToolOutput({ tool: "browser", text: wrap("Opened mail.example") });
    expect(shown).toBe("Opened mail.example");
    expect(shown).not.toMatch(/UNTRUSTED|SECURITY NOTICE|<<<|Source: Web/);
  });

  it("replaces a computer process list with a short plain line", () => {
    const shown = displayToolOutput({ tool: "computer", text: processList });
    expect(shown).toBe(CHECKED_WHATS_OPEN);
    expect(shown).not.toContain("demo-app");
    expect(shown).not.toContain("4242");
    expect(shown).not.toContain("pid");
  });

  it("replaces a marker-wrapped process list the same way", () => {
    const shown = displayToolOutput({ tool: "computer", text: wrap(processList) });
    expect(shown).toBe(CHECKED_WHATS_OPEN);
    expect(shown).not.toMatch(/UNTRUSTED|demo-app|4242/);
  });

  it("replaces a truncated computer detail that still names demo-app and a pid", () => {
    const shown = displayToolOutput({ tool: "computer", text: wrap(processList).slice(0, 220) });
    expect(shown).toBe(CHECKED_WHATS_OPEN);
    expect(shown).not.toContain("demo-app");
  });

  it("shows a plain-words summary for a browser result of raw JSON, never the object", () => {
    const shown = displayToolOutput({
      tool: "browser",
      text: browserJson,
      title: "Opened mail.example",
    });
    expect(shown).toBe("Opened mail.example");
    expect(shown).not.toContain("{");
    expect(shown).not.toContain("targetUrl");
    expect(shown).not.toContain("waitMs");
  });

  it("falls back to a short plain line when browser JSON has no friendly title", () => {
    const shown = displayToolOutput({ tool: "browser", text: browserJson });
    expect(shown).toBe("Used the browser");
    expect(shown).not.toContain("{");
  });

  it("still shows a normal friendly result", () => {
    expect(displayToolOutput({ tool: "bash", text: "Typecheck passed" })).toBe("Typecheck passed");
    expect(displayToolOutput({ tool: "browser", text: "Opened mail.example" })).toBe("Opened mail.example");
    expect(displayToolOutput({ tool: "computer", text: "Clicked Sign in" })).toBe("Clicked Sign in");
  });

  it("hides the #684 browser status payload and computer list_apps inventory", () => {
    const status = '{"enabled": true, "profile": "branch", "driver": "demo"}';
    expect(displayToolOutput({ tool: "browser", text: status, title: "Checked the browser" })).toBe("Checked the browser");
    expect(displayToolOutput({ tool: "browser", text: status })).toBe("Used the browser");
    const apps = JSON.stringify({
      action: "list_apps",
      ok: true,
      details: { apps: [{ app: "cua:v2:app:demo", name: "demo-app" }] },
    });
    const listed = displayToolOutput({ tool: "computer", text: wrap(apps) });
    expect(listed).toBe(CHECKED_WHATS_OPEN);
    expect(listed).not.toMatch(/UNTRUSTED|demo-app|cua:v2/);
  });

  it("does not show a failed computer result as raw JSON", () => {
    const failed =
      '{"status":"error","tool":"computer","error":"Error: COMPUTER_STALE_OBSERVATION: refresh list_apps and retry"}';
    const shown = displayToolOutput({ tool: "computer", text: failed });
    expect(shown).not.toContain("{");
    expect(shown).not.toContain("\"status\"");
  });
});

describe("displayToolInput", () => {
  it("drops computer and browser argument JSON from the expanded card", () => {
    expect(displayToolInput("computer", JSON.stringify({ action: "list_windows" }, null, 2))).toBeUndefined();
    expect(displayToolInput("browser", browserJson)).toBeUndefined();
    expect(displayToolInput("github_publish", '{\n  "draft": true\n}')).toBe('{\n  "draft": true\n}');
  });
});

describe("sanitizeStepDisplay", () => {
  it("rewrites output, detail and input together", () => {
    const cleaned = sanitizeStepDisplay(
      step({
        title: "Opened mail.example",
        detail: wrap(processList).slice(0, 400),
        output: wrap(processList),
        input: JSON.stringify({ action: "list_windows" }, null, 2),
      }),
    );
    expect(cleaned.output).toBe(CHECKED_WHATS_OPEN);
    expect(cleaned.detail).toBe(CHECKED_WHATS_OPEN);
    expect(cleaned.input).toBeUndefined();
    expect(JSON.stringify(cleaned)).not.toMatch(/UNTRUSTED|demo-app|"pid"/);
  });

  it("keeps an Exit line as the detail", () => {
    expect(sanitizeStepDisplay(step({ tool: "bash", detail: "Exit 0", output: "ok" })).detail).toBe("Exit 0");
  });
});

describe("history and live blocks", () => {
  it("sanitizes a stored computer result that listed demo-app", () => {
    const blocks = historyToBlocks(
      [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "computer", arguments: { action: "list_windows" } }],
          stopReason: "toolUse",
        },
        {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "computer",
          content: [{ type: "text", text: wrap(processList) }],
        },
      ],
      [],
      "agent:scout:one",
      null,
    );
    const card = blocks.find((b): b is Extract<Block, { kind: "step" }> => b.kind === "step");
    expect(card?.output).toBe(CHECKED_WHATS_OPEN);
    expect(card?.detail).toBe(CHECKED_WHATS_OPEN);
    expect(card?.input).toBeUndefined();
    expect(JSON.stringify(blocks)).not.toMatch(/UNTRUSTED|demo-app|4242/);
  });

  it("leaves a friendly bash result on a live block", () => {
    const [live] = sanitizeBlocks([step({ tool: "bash", title: "node -v", output: "v24.19.0", detail: "v24.19.0" })]);
    expect(live).toMatchObject({ kind: "step", output: "v24.19.0", detail: "v24.19.0" });
  });
});
