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
import { fullOutput, keepOutput, type Block } from "./model";

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

const wrappedListApps = (count: number) =>
  wrap(
    JSON.stringify({
      action: "list_apps",
      ok: true,
      details: {
        apps: Array.from({ length: count }, (_, i) => ({ app: `cua:v2:app:proc-${i}`, name: "demo-app" })),
      },
    }),
  );

const assertCardSafe = (value: unknown) => {
  if (value == null) return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text).not.toContain("{");
  expect(text).not.toMatch(/UNTRUSTED|demo-app|cua:v2|"pid"|"apps"/);
};

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

  it("hides a wrapped list_apps inventory longer than 400 characters in history", () => {
    const wrapped = wrappedListApps(40);
    expect(wrapped.length).toBeGreaterThan(400);
    const blocks = historyToBlocks(
      [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "c-long", name: "computer", arguments: { action: "list_apps" } }],
          stopReason: "toolUse",
        },
        {
          role: "toolResult",
          toolCallId: "c-long",
          toolName: "computer",
          content: [{ type: "text", text: wrapped }],
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
    assertCardSafe(card?.detail);
    assertCardSafe(card?.output);
    assertCardSafe(card?.input);
    expect(fullOutput(card?.outputKey ?? card?.key ?? "")).toBeUndefined();
  });
});

describe("truncated computer payloads", () => {
  it("hides the first 400 characters of a wrapped list_apps inventory", () => {
    const wrapped = wrappedListApps(40);
    expect(wrapped.length).toBeGreaterThan(400);
    const shown = displayToolOutput({ tool: "computer", text: wrapped.slice(0, 400) });
    expect(shown).toBe(CHECKED_WHATS_OPEN);
    assertCardSafe(shown);
  });

  it("exports a long wrapped list_apps inventory cleaned, not raw", () => {
    const wrapped = wrappedListApps(80);
    expect(wrapped.length).toBeGreaterThan(2000);
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c-export", name: "computer", arguments: { action: "list_apps" } }],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        toolCallId: "c-export",
        toolName: "computer",
        content: [{ type: "text", text: wrapped }],
      },
    ];
    const exported = historyToBlocks(messages, [], "agent:scout:one", null, { wholeOutput: true }).find(
      (b): b is Extract<Block, { kind: "step" }> => b.kind === "step",
    );
    expect(exported?.output).toBe(CHECKED_WHATS_OPEN);
    expect(exported?.detail).toBe(CHECKED_WHATS_OPEN);
    expect(exported?.input).toBeUndefined();
    expect(fullOutput(exported?.outputKey ?? exported?.key ?? "")).toBeUndefined();
    assertCardSafe(exported?.detail);
    assertCardSafe(exported?.output);
    assertCardSafe(exported?.input);
  });

  it("leaves a long bash result whole when history asks for wholeOutput", () => {
    const output = "x".repeat(5_000);
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "bash-big", name: "bash", arguments: { command: "cat big" } }],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        toolCallId: "bash-big",
        toolName: "bash",
        content: [{ type: "text", text: output }],
      },
    ];
    const whole = historyToBlocks(messages, [], "agent:scout:one", null, { wholeOutput: true }).find(
      (b): b is Extract<Block, { kind: "step" }> => b.kind === "step",
    );
    const shown = historyToBlocks(messages, [], "agent:scout:one", null).find(
      (b): b is Extract<Block, { kind: "step" }> => b.kind === "step",
    );
    expect(whole?.output).toBe(output);
    expect(shown?.output?.length ?? 0).toBeLessThan(2_100);
    expect(whole?.detail.length ?? 0).toBeLessThanOrEqual(400);
    expect(shown?.detail.length ?? 0).toBeLessThanOrEqual(400);
  });

  it("keeps a long bash detail at 400 characters or fewer", () => {
    const output = "x".repeat(2_764);
    expect(output.length).toBeGreaterThan(2000);
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "bash-detail", name: "bash", arguments: { command: "cat log" } }],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        toolCallId: "bash-detail",
        toolName: "bash",
        content: [{ type: "text", text: output }],
      },
    ];
    const shown = historyToBlocks(messages, [], "agent:scout:one", null).find(
      (b): b is Extract<Block, { kind: "step" }> => b.kind === "step",
    );
    const exported = historyToBlocks(messages, [], "agent:scout:one", null, { wholeOutput: true }).find(
      (b): b is Extract<Block, { kind: "step" }> => b.kind === "step",
    );
    expect(shown?.detail.length ?? 0).toBeLessThanOrEqual(400);
    expect(exported?.detail.length ?? 0).toBeLessThanOrEqual(400);
    expect(exported?.output).toBe(output);
  });

  it("clears fullOutput after a computer result longer than 2000 characters", () => {
    const wrapped = wrappedListApps(80);
    expect(wrapped.length).toBeGreaterThan(2000);
    const key = "computer:long-output";
    const tail = keepOutput(key, wrapped);
    expect(fullOutput(key)).toBe(wrapped);
    const cleaned = sanitizeStepDisplay(
      step({
        key,
        outputKey: key,
        title: "list_apps",
        detail: wrapped.slice(0, 400),
        output: tail,
        input: '{\n  "action": "list_apps"\n}',
      }),
    );
    expect(cleaned.output).toBe(CHECKED_WHATS_OPEN);
    expect(cleaned.detail).toBe(CHECKED_WHATS_OPEN);
    expect(cleaned.input).toBeUndefined();
    expect(fullOutput(key)).toBeUndefined();
    assertCardSafe(cleaned.detail);
    assertCardSafe(cleaned.output);
    assertCardSafe(cleaned.input);
  });
});
