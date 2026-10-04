// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/core/src/memory/mock-working-memory-merge.test.ts, packages/core/src/processors/memory/working-memory.test.ts.
import { describe, expect, it } from "vitest";
import { createCaptureHarness, runTool } from "./capture-registration.test-support.js";
import {
  buildReadOnlyWorkingMemoryInstruction,
  buildWorkingMemoryToolInstruction,
  deepMergeWorkingMemory,
  DEFAULT_WORKING_MEMORY_TEMPLATE,
  resolveWorkingMemoryUpdate,
  stripNullsFromOptional,
} from "./working-memory.js";

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
    location: { type: "string" },
  },
};

describe("working memory merge semantics", () => {
  const markdown = { format: "markdown" as const, content: DEFAULT_WORKING_MEMORY_TEMPLATE };

  function update(existing: string | null, input: unknown, schema?: Record<string, unknown>) {
    const result = resolveWorkingMemoryUpdate({ input, existing, template: markdown, schema });
    if (!result.ok) {
      throw new Error(result.message);
    }
    return result.workingMemory;
  }

  it("replaces working memory entirely for template-based (no schema)", () => {
    const first = update(null, JSON.stringify({ name: "Alice", age: 30, location: "NYC" }));
    const second = update(first, JSON.stringify({ location: "LA" }));
    expect(JSON.parse(second)).toEqual({ location: "LA" });
  });

  it("merges working memory for schema-based configs", () => {
    const first = update(null, JSON.stringify({ name: "Alice", age: 30, location: "NYC" }), SCHEMA);
    expect(JSON.parse(update(first, JSON.stringify({ location: "LA" }), SCHEMA))).toEqual({
      name: "Alice",
      age: 30,
      location: "LA",
    });
  });

  it("overwrites fields in schema-based merge when explicitly provided", () => {
    const first = update(null, JSON.stringify({ name: "Alice", age: 30 }), SCHEMA);
    expect(JSON.parse(update(first, JSON.stringify({ name: "Bob", age: 25 }), SCHEMA))).toEqual({
      name: "Bob",
      age: 25,
    });
  });

  it("handles first write with no existing data in schema mode", () => {
    expect(JSON.parse(update(null, JSON.stringify({ name: "Alice" }), SCHEMA))).toEqual({
      name: "Alice",
    });
  });

  it("deep-merges nested objects", () => {
    const merged = deepMergeWorkingMemory(
      { user: { name: "Alice", address: { city: "NYC", state: "NY" } } },
      { user: { address: { city: "LA" } } },
    );
    expect(merged).toEqual({ user: { name: "Alice", address: { city: "LA", state: "NY" } } });
  });

  it("deletes keys set to null, also on the first write and inside new nested objects", () => {
    expect(deepMergeWorkingMemory({ name: "Alice", age: 30, location: "NYC" }, { age: null })).toEqual({
      name: "Alice",
      location: "NYC",
    });
    expect(deepMergeWorkingMemory(null, { name: "Alice", age: null })).toEqual({ name: "Alice" });
    expect(deepMergeWorkingMemory({ name: "Alice" }, { user: { name: "Bob", city: null } })).toEqual({
      name: "Alice",
      user: { name: "Bob" },
    });
  });

  it("replaces arrays entirely and never aliases the update", () => {
    const update = { tags: ["x"] };
    const merged = deepMergeWorkingMemory({ tags: ["a", "b", "c"], count: 3 }, update);
    expect(merged).toEqual({ tags: ["x"], count: 3 });
    expect(merged).not.toBe(update);
  });

  it("treats padded nulls for optional schema fields as not provided", () => {
    expect(stripNullsFromOptional({ name: "Bob", age: null, extra: null }, SCHEMA)).toEqual({
      name: "Bob",
      extra: null,
    });
    const first = update(null, { name: "Alice", age: 30 }, SCHEMA);
    expect(JSON.parse(update(first, { name: "Bob", age: null }, SCHEMA))).toEqual({
      name: "Bob",
      age: 30,
    });
  });

  it("refuses to replace meaningful data with the empty template", () => {
    const result = resolveWorkingMemoryUpdate({
      input: DEFAULT_WORKING_MEMORY_TEMPLATE,
      existing: "# User Information\n- **First Name**: Ana",
      template: markdown,
    });
    expect(result).toEqual({
      ok: false,
      message:
        "Attempted to replace existing working memory with empty template. Update skipped to prevent data loss.",
    });
  });
});

describe("working memory instructions", () => {
  it("uses the default template and the update tool name", () => {
    const text = buildWorkingMemoryToolInstruction({
      template: { format: "markdown", content: DEFAULT_WORKING_MEMORY_TEMPLATE },
      data: null,
    });
    expect(text).toContain("WORKING_MEMORY_SYSTEM_INSTRUCTION");
    expect(text).toContain("# User Information");
    expect(text).toContain("update_working_memory");
    expect(text).toContain("<working_memory_data>\nNo working memory data available.\n</working_memory_data>");
  });

  it("uses a custom template when provided", () => {
    const text = buildWorkingMemoryToolInstruction({
      template: { format: "markdown", content: "# Custom Template\n- Field 1:\n- Field 2:" },
      data: "",
    });
    expect(text).toContain("# Custom Template");
    expect(text).toContain("- Field 1:");
    expect(text).toContain("<working_memory_data>");
  });

  it("renders a fallback instead of null for JSON templates", () => {
    const text = buildWorkingMemoryToolInstruction({
      template: { format: "json", content: { type: "object", properties: { name: { type: "string" } } } },
      data: null,
    });
    expect(text).toContain("<working_memory_data>\nNo working memory data available.\n</working_memory_data>");
    expect(text).not.toContain("<working_memory_template>");
  });

  it("uses the read-only format without update instructions", () => {
    const text = buildReadOnlyWorkingMemoryInstruction("# User Info\n- Name: John");
    expect(text).toContain("WORKING_MEMORY_SYSTEM_INSTRUCTION (READ-ONLY)");
    expect(text).toContain("# User Info\n- Name: John");
    expect(text).toContain("read-only in the current session");
    expect(text).toContain("Act naturally");
    expect(text).not.toContain("update_working_memory");
    expect(text).not.toContain("Store and update");
    expect(buildReadOnlyWorkingMemoryInstruction(null)).toContain("No working memory data available.");
  });
});

describe("working memory in Branch", () => {
  const workspaceDir = "/unused-workspace";

  async function promptContext(harness: ReturnType<typeof createCaptureHarness>, sessionKey = "agent:main:main") {
    const result = (await harness.hook("before_prompt_build")(
      { prompt: "hi", messages: [] },
      { agentId: "main", sessionKey, trigger: "user" },
    )) as { prependContext?: string } | undefined;
    return result?.prependContext;
  }

  it("is off by default, like mastra's memoryDefaultOptions", async () => {
    const harness = createCaptureHarness({ workspaceDir });
    expect(harness.tool("update_working_memory")).toBeNull();
    expect(await promptContext(harness)).toBeUndefined();
  });

  it("stores the scratchpad with the tool and shows it every turn, across a restart", async () => {
    const stateRows = new Map<string, unknown>();
    const pluginConfig = { workingMemory: { enabled: true } };
    const harness = createCaptureHarness({ workspaceDir, pluginConfig, stateRows });
    expect(await promptContext(harness)).toContain("No working memory data available.");
    expect(
      await runTool(harness.tool("update_working_memory"), {
        memory: "# User Information\n- **First Name**: Ana",
      }),
    ).toEqual({ success: true });
    const restarted = createCaptureHarness({ workspaceDir, pluginConfig, stateRows });
    const context = await promptContext(restarted, "agent:main:other");
    expect(context).toContain("- **First Name**: Ana");
    expect(context).toContain("WORKING_MEMORY_SYSTEM_INSTRUCTION");
  });

  it("keeps session-scoped scratchpads apart", async () => {
    const harness = createCaptureHarness({
      workspaceDir,
      pluginConfig: { workingMemory: { enabled: true, scope: "session" } },
    });
    await runTool(harness.tool("update_working_memory", { sessionKey: "agent:main:a" }), {
      memory: "note for A",
    });
    expect(await promptContext(harness, "agent:main:a")).toContain("note for A");
    expect(await promptContext(harness, "agent:main:b")).not.toContain("note for A");
  });

  it("merges JSON when a schema is configured, and read-only mode hides the tool", async () => {
    const harness = createCaptureHarness({
      workspaceDir,
      pluginConfig: { workingMemory: { enabled: true, schema: SCHEMA } },
    });
    const tool = harness.tool("update_working_memory");
    await runTool(tool, { memory: { name: "Alice", age: 30 } });
    await runTool(tool, { memory: JSON.stringify({ location: "LA" }) });
    expect(await promptContext(harness)).toContain('{"name":"Alice","age":30,"location":"LA"}');
    const readOnly = createCaptureHarness({
      workspaceDir,
      pluginConfig: { workingMemory: { enabled: true, readOnly: true } },
    });
    expect(readOnly.tool("update_working_memory")).toBeNull();
    expect(await promptContext(readOnly)).toContain("(READ-ONLY)");
  });
});
