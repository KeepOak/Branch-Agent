import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnyAgentTool } from "./common.js";
import { createSequentialThinkingTool } from "./sequential-thinking-tool.js";

type GoldenStep = { input: unknown; output: unknown; logs: unknown[] };
type GoldenCase = {
  id: string;
  fn: string;
  kind: string;
  source: string;
  output?: unknown;
  sequence?: GoldenStep[];
};

const golden = JSON.parse(
  readFileSync(new URL("./sequential-thinking-tool.golden.json", import.meta.url), "utf8"),
) as GoldenCase[];

const PLACEHOLDER = "<REDACTED";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeInput);
  }
  if (!isRecord(value)) {
    return value;
  }
  if (value.$undef === true) {
    return undefined;
  }
  if (typeof value.$num === "string") {
    return Number(value.$num);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeInput(item)]),
  );
}

function toWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDescriptions);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "description")
      .map(([key, item]) => [key, stripDescriptions(item)]),
  );
}

function collectDescriptions(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectDescriptions(item, found));
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "description" && typeof item === "string") {
        found.push(item);
      } else {
        collectDescriptions(item, found);
      }
    }
  }
  return found;
}

function freshTool(): AnyAgentTool {
  return createSequentialThinkingTool();
}

function thought(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    thought: "step",
    nextThoughtNeeded: true,
    thoughtNumber: 1,
    totalThoughts: 3,
    ...overrides,
  };
}

function detailsOf(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !isRecord(result.details)) {
    throw new Error("result has no details object");
  }
  return result.details;
}

describe("sequentialthinking descriptor", () => {
  const tool = freshTool();
  const descriptor = golden.find((item) => item.source === "tool-descriptor");

  it("has the tool name and label", () => {
    expect(tool.name).toBe("sequentialthinking");
    expect(tool.label).toBe("Sequential thinking");
  });

  it("exposes exactly the golden key set", () => {
    expect(Object.keys(tool).sort()).toEqual(["description", "execute", "label", "name", "parameters"]);
    expect(typeof tool.execute).toBe("function");
  });

  it("matches the golden parameter schema once prose is removed", () => {
    const expected = descriptor?.output;
    const actual = {
      name: tool.name,
      label: tool.label,
      parameters: tool.parameters,
      hasExecute: typeof tool.execute === "function",
      keys: Object.keys(tool).sort(),
    };
    expect(stripDescriptions(actual)).toEqual(stripDescriptions(expected));
  });

  it("declares the required fields and minimum bounds", () => {
    const schema = tool.parameters as { required?: unknown; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"]);
    expect(schema.properties).toMatchObject({
      thoughtNumber: { type: "integer", minimum: 1 },
      totalThoughts: { type: "integer", minimum: 1 },
      revisesThought: { type: "integer", minimum: 1 },
      branchFromThought: { type: "integer", minimum: 1 },
    });
  });

  it("has non-empty, non-placeholder prose for the tool and every field", () => {
    const prose = [tool.description, ...collectDescriptions(tool.parameters)];
    expect(prose.length).toBe(10);
    for (const text of prose) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain(PLACEHOLDER);
    }
  });
});

describe("sequentialthinking instances", () => {
  it("golden independence: same name, distinct objects", () => {
    const independence = golden.find((item) => item.source === "instances-are-independent");
    const first = freshTool();
    const second = freshTool();
    expect({ sameName: first.name === second.name, distinctObjects: first !== second }).toEqual(
      independence?.output,
    );
  });

  it("keeps history and branches per instance", async () => {
    const first = freshTool();
    const second = freshTool();
    await first.execute("a", thought({ branchFromThought: 1, branchId: "alt" }));
    await first.execute("b", thought({ thoughtNumber: 2 }));
    const other = detailsOf(await second.execute("c", thought()));
    expect(other.thoughtHistoryLength).toBe(1);
    expect(other.branches).toEqual([]);
  });
});

describe("sequentialthinking golden sessions", () => {
  const sessions = golden.filter((item) => item.sequence !== undefined);

  it.each(sessions)("$id $kind $source", async (kase) => {
    const tool = freshTool();
    const steps = kase.sequence ?? [];
    for (const [index, step] of steps.entries()) {
      const result = await tool.execute(`call-${index}`, decodeInput(step.input));
      expect(toWire(result), `step ${index}`).toEqual(step.output);
    }
  });
});

describe("sequentialthinking validation and output", () => {
  it("returns validation failures as results, not thrown errors", async () => {
    const result = await freshTool().execute("call", thought({ thought: "" }));
    expect(result).toMatchObject({
      content: [{ type: "text", text: '{\n  "error": "Invalid thought: must be a string",\n  "status": "failed"\n}' }],
      details: { error: "Invalid thought: must be a string", status: "failed", isError: true },
    });
  });

  it("leaves history and branches unchanged after a failed call", async () => {
    const tool = freshTool();
    await tool.execute("a", thought({ branchFromThought: 1, branchId: "alt" }));
    await tool.execute("b", thought({ nextThoughtNeeded: "no" }));
    const after = detailsOf(await tool.execute("c", thought({ thoughtNumber: 2 })));
    expect(after.thoughtHistoryLength).toBe(2);
    expect(after.branches).toEqual(["alt"]);
  });

  it("reports the first invalid field in check order", async () => {
    const result = await freshTool().execute(
      "call",
      { thought: 5, nextThoughtNeeded: "x", thoughtNumber: "x", totalThoughts: "x" },
    );
    expect(detailsOf(result).error).toBe("Invalid thought: must be a string");
  });

  it("accepts negative and fractional numbers despite minimum 1", async () => {
    const tool = freshTool();
    const negative = detailsOf(await tool.execute("a", thought({ thoughtNumber: -1, totalThoughts: 1 })));
    expect(negative.thoughtNumber).toBe(-1);
    const fractional = detailsOf(await tool.execute("b", thought({ thoughtNumber: 1.5, totalThoughts: 1 })));
    expect(fractional.totalThoughts).toBe(1.5);
  });

  it("rejects zero and NaN for numeric fields", async () => {
    const tool = freshTool();
    const zero = detailsOf(await tool.execute("a", thought({ thoughtNumber: 0 })));
    expect(zero.error).toBe("Invalid thoughtNumber: must be a number");
    const nan = detailsOf(await tool.execute("b", thought({ totalThoughts: Number.NaN })));
    expect(nan.error).toBe("Invalid totalThoughts: must be a number");
  });

  it("raises totalThoughts to thoughtNumber only when thoughtNumber is larger", async () => {
    const tool = freshTool();
    const raised = detailsOf(await tool.execute("a", thought({ thoughtNumber: 5, totalThoughts: 3 })));
    expect(raised.totalThoughts).toBe(5);
    const kept = detailsOf(await tool.execute("b", thought({ thoughtNumber: 2, totalThoughts: 3 })));
    expect(kept.totalThoughts).toBe(3);
  });

  it("records a branch only when branchFromThought and branchId are both present", async () => {
    const tool = freshTool();
    const idOnly = detailsOf(await tool.execute("a", thought({ branchId: "solo" })));
    expect(idOnly.branches).toEqual([]);
    const both = detailsOf(await tool.execute("b", thought({ branchFromThought: 1, branchId: "alt" })));
    expect(both.branches).toEqual(["alt"]);
    const repeat = detailsOf(await tool.execute("c", thought({ branchFromThought: 2, branchId: "alt" })));
    expect(repeat.branches).toEqual(["alt"]);
    const other = detailsOf(await tool.execute("d", thought({ branchFromThought: 2, branchId: "beta" })));
    expect(other.branches).toEqual(["alt", "beta"]);
  });

  it("does not record a branch from an empty branchId or zero branchFromThought", async () => {
    const tool = freshTool();
    const emptyId = detailsOf(await tool.execute("a", thought({ branchFromThought: 1, branchId: "" })));
    expect(emptyId.branches).toEqual([]);
    const zeroFrom = detailsOf(await tool.execute("b", thought({ branchFromThought: 0, branchId: "x" })));
    expect(zeroFrom.branches).toEqual([]);
  });

  it("accepts any type for optional fields without effect on output", async () => {
    const tool = freshTool();
    const details = detailsOf(
      await tool.execute("a", thought({ revisesThought: "word", isRevision: [], needsMoreThoughts: {} })),
    );
    expect(Object.keys(details).sort()).toEqual(
      ["branches", "nextThoughtNeeded", "thought", "thoughtHistoryLength", "thoughtNumber", "totalThoughts"],
    );
    expect(details.thoughtHistoryLength).toBe(1);
  });

  it("accepts whitespace-only thoughts and repeated or out-of-order numbers", async () => {
    const tool = freshTool();
    await tool.execute("a", thought({ thoughtNumber: 5, totalThoughts: 5 }));
    const back = detailsOf(await tool.execute("b", thought({ thought: "   ", thoughtNumber: 4, totalThoughts: 5 })));
    expect(back.thought).toBe("   ");
    expect(back.thoughtHistoryLength).toBe(2);
  });

  it("returns a branches snapshot that later calls do not change", async () => {
    const tool = freshTool();
    const first = detailsOf(await tool.execute("a", thought({ branchFromThought: 1, branchId: "one" })));
    await tool.execute("b", thought({ branchFromThought: 1, branchId: "two" }));
    expect(first.branches).toEqual(["one"]);
  });
});
