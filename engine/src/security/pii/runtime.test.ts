// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/runtime.spec.ts (atlas SAFETY-0062)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILTER_PII_STARTER_PATTERNS, type FiltersConfig } from "./filters.js";
import { createConfiguredContentInspector, inspectContent } from "./runtime.js";
import type { ContentFieldMap, TextContentFragment } from "./types.js";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => logger,
}));

const BLOCK_PATTERN = {
  id: "org-token",
  label: "organization token",
  regex: "ORG-[A-Z]+",
};

const STARTER_PATTERN_CASES = [
  ["sk_prefix", "sk-project-CONTRACT"],
  ["bearer_header", "Authorization: Bearer contract-token"],
  ["api_key_header", "api-key: contract-token"],
  ["email", "write to alice@example.com"],
  ["api_key", "use AKIAIOSFODNN7EXAMPLE please"],
  ["national_id", "id 11010519491231002X"],
  ["credit_card", "card 4111 1111 1111 1111 on file"],
  ["phone", "call +86 138 0013 8000 now"],
] as const;

function fragment(
  field: ContentFieldMap["tool_argument"],
  text = "ORG-SECRET",
): TextContentFragment {
  return {
    id: `tool_argument.${field}`,
    text,
    path: `/tool_argument/${field}`,
    source: "tool_argument",
    field,
    format: "plain",
    treatment: "replaceable",
    provenance: "user",
  };
}

function toolArgumentFilters(
  pii: NonNullable<FiltersConfig["toolArguments"]>["pii"],
): FiltersConfig {
  return { toolArguments: { pii } };
}

describe("configured content inspection", () => {
  beforeEach(() => {
    logger.info.mockClear();
  });

  it("does no work when neither the generic nor legacy filter is configured", () => {
    expect(createConfiguredContentInspector({})).toBeNull();
    expect(inspectContent([fragment("arguments")], {})).toBeNull();
  });

  it("selects generic rules by both source and field and returns raw-free metadata", () => {
    const filters = toolArgumentFilters({
      fields: ["arguments"],
      starterPatterns: [],
      customPatterns: [BLOCK_PATTERN],
    });
    const secret = "ORG-DO-NOT-ECHO";

    const finding = inspectContent([fragment("name", secret), fragment("arguments", secret)], {
      filters,
    });

    expect(finding).toEqual({
      detectorId: "pii-pattern",
      ruleId: "org-token",
      label: "organization token",
      source: "tool_argument",
      field: "arguments",
      provenance: "user",
      fragmentId: "tool_argument.arguments",
      fragmentPath: "/tool_argument/arguments",
    });
    expect(JSON.stringify(finding)).not.toContain(secret);
  });

  it("records audit-only findings without returning an enforcement finding or raw text", () => {
    const filters = toolArgumentFilters({
      action: "audit",
      starterPatterns: [],
      customPatterns: [BLOCK_PATTERN],
    });
    const secret = "ORG-DO-NOT-ECHO";

    expect(inspectContent([fragment("arguments", secret)], { filters })).toBeNull();
    const metadata = {
      action: "audit",
      detectorId: "pii-pattern",
      ruleId: "org-token",
      label: "organization token",
      source: "tool_argument",
      field: "arguments",
      provenance: "user",
      occurrences: 1,
    };
    expect(logger.info).toHaveBeenCalledWith(
      `[content-filter] Audit-only finding ${JSON.stringify(metadata)}`,
      metadata,
    );
    const calls = logger.info.mock.calls;
    expect(JSON.stringify(calls[calls.length - 1])).not.toContain(secret);
  });

  it("treats an omitted fields list as every field within only that source", () => {
    const filters = toolArgumentFilters({ starterPatterns: [], customPatterns: [BLOCK_PATTERN] });

    expect(inspectContent([fragment("name")], { filters })).toMatchObject({ field: "name" });
    expect(inspectContent([fragment("arguments")], { filters })).toMatchObject({
      source: "tool_argument",
      field: "arguments",
    });
  });

  it("keeps all starter patterns enabled when only custom patterns are configured", () => {
    const filters = toolArgumentFilters({ customPatterns: [BLOCK_PATTERN] });

    expect(
      inspectContent([fragment("arguments", "sk-proj-DEFAULT-STARTER")], { filters }),
    ).toMatchObject({
      ruleId: "sk_prefix",
    });
  });

  it.each(STARTER_PATTERN_CASES)("registers the %s starter pattern", (ruleId, text) => {
    const filters = toolArgumentFilters({ starterPatterns: [ruleId] });

    expect(inspectContent([fragment("arguments", text)], { filters })).toMatchObject({
      ruleId,
    });
  });

  it("keeps the runtime starter catalog aligned with the public schema", () => {
    expect(FILTER_PII_STARTER_PATTERNS).toEqual(STARTER_PATTERN_CASES.map(([ruleId]) => ruleId));
  });

  it("treats an explicit empty starter list with no custom patterns as no text matching", () => {
    const filters = toolArgumentFilters({ starterPatterns: [] });

    expect(
      inspectContent([fragment("arguments", "sk-project-EXPLICITLY-DISABLED")], { filters }),
    ).toBeNull();
    expect(createConfiguredContentInspector({ filters })).toBeNull();
  });

  it("registers the tool arguments source", () => {
    const filters = toolArgumentFilters({ customPatterns: [BLOCK_PATTERN] });
    expect(inspectContent([fragment("arguments")], { filters })).toMatchObject({
      source: "tool_argument",
      field: "arguments",
    });
  });

  it("keeps name and arguments field selections independent", () => {
    const filters = toolArgumentFilters({
      fields: ["arguments"],
      starterPatterns: [],
      customPatterns: [BLOCK_PATTERN],
    });

    expect(inspectContent([fragment("name")], { filters })).toBeNull();
    expect(inspectContent([fragment("arguments")], { filters })).not.toBeNull();
  });

  it("memoizes inspectors by config identity and stops reading after the first finding", () => {
    const filters = toolArgumentFilters({ starterPatterns: [], customPatterns: [BLOCK_PATTERN] });
    const inspector = createConfiguredContentInspector({ filters });
    const readLater = vi.fn();
    function* content(): Generator<TextContentFragment> {
      yield fragment("arguments");
      readLater();
      yield fragment("arguments", "ORG-LATER");
    }

    expect(createConfiguredContentInspector({ filters })).toBe(inspector);
    expect(inspector?.inspect(content())).not.toBeNull();
    expect(readLater).not.toHaveBeenCalled();
  });

  it("inspects identical text once per applicable source filter", () => {
    const filters = toolArgumentFilters({ starterPatterns: [], customPatterns: [BLOCK_PATTERN] });
    const inspector = createConfiguredContentInspector({ filters });
    const patternTest = vi.spyOn(RegExp.prototype, "test");
    let callCount = 0;

    try {
      expect(
        inspector?.inspect([
          fragment("name", "repeated safe text"),
          fragment("arguments", "repeated safe text"),
          fragment("arguments", "repeated safe text"),
        ]),
      ).toBeNull();
      callCount = patternTest.mock.calls.length;
    } finally {
      patternTest.mockRestore();
    }

    expect(callCount).toBe(1);
  });

  it("shares dedupe state across one bounded inspection session only", () => {
    const filters = toolArgumentFilters({ starterPatterns: [], customPatterns: [BLOCK_PATTERN] });
    const inspector = createConfiguredContentInspector({ filters });
    const session = inspector?.createSession();
    const patternTest = vi.spyOn(RegExp.prototype, "test");

    try {
      expect(session?.inspectFragment(fragment("arguments", "repeated safe text"))).toBeNull();
      expect(session?.inspect([fragment("name", "repeated safe text")])).toBeNull();
      expect(patternTest).toHaveBeenCalledTimes(1);

      expect(
        inspector?.createSession().inspect([fragment("arguments", "repeated safe text")]),
      ).toBeNull();
      expect(patternTest).toHaveBeenCalledTimes(2);
    } finally {
      patternTest.mockRestore();
    }
  });

  it("bounds cross-batch dedupe memory without skipping inspection", () => {
    const filters = toolArgumentFilters({ starterPatterns: [], customPatterns: [BLOCK_PATTERN] });
    const session = createConfiguredContentInspector({ filters })?.createSession();
    const fragments = Array.from({ length: 4_097 }, (_, index) =>
      fragment("arguments", `safe unique text ${index}`),
    );
    const patternTest = vi.spyOn(RegExp.prototype, "test");

    try {
      expect(session?.inspect(fragments)).toBeNull();
      expect(patternTest).toHaveBeenCalledTimes(4_097);

      expect(session?.inspectFragment(fragment("arguments", "safe unique text 0"))).toBeNull();
      expect(patternTest).toHaveBeenCalledTimes(4_097);
      expect(session?.inspectFragment(fragment("arguments", "safe unique text 4096"))).toBeNull();
      expect(patternTest).toHaveBeenCalledTimes(4_098);
    } finally {
      patternTest.mockRestore();
    }
  });

  it("evaluates ambiguous custom patterns with the linear-time engine", () => {
    const filters = toolArgumentFilters({
      starterPatterns: [],
      customPatterns: [{ id: "ambiguous", label: "ambiguous text", regex: "(a|aa)+$" }],
    });

    expect(
      inspectContent([fragment("arguments", `${"a".repeat(100_000)}!`)], { filters }),
    ).toBeNull();
  });

  it("rejects aggregate regex characters before compiling regex programs or sets", () => {
    const makePatterns = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${prefix}-${index}`,
        label: `${prefix} ${index}`,
        regex: `${prefix}${index}${"x".repeat(512 - prefix.length - String(index).length)}`,
      }));
    const filters = toolArgumentFilters({
      starterPatterns: [],
      customPatterns: makePatterns("character-tool", 17),
    });

    expect(() => createConfiguredContentInspector({ filters })).toThrow(
      "custom patterns exceed 8192 regex characters",
    );
  });

  it("accepts the aggregate custom-pattern count boundary", () => {
    const filters = toolArgumentFilters({
      starterPatterns: [],
      customPatterns: Array.from({ length: 256 }, (_, index) => ({
        id: `boundary-tool-${index}`,
        label: `boundary tool ${index}`,
        regex: `BOUNDARY-TOOL-${index}`,
      })),
    });

    expect(createConfiguredContentInspector({ filters })).not.toBeNull();
  });

  it("bounds fields and pattern carriers without dispatching custom iterators", () => {
    let fieldLengthReads = 0;
    let fieldIteratorReads = 0;
    const fields = new Proxy(["arguments"], {
      get(target, property, receiver) {
        if (property === "length") {
          fieldLengthReads++;
        } else if (property === Symbol.iterator) {
          fieldIteratorReads++;
          throw new Error("field iterator must not run");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const filters = {
      toolArguments: { pii: { fields, starterPatterns: [], customPatterns: [BLOCK_PATTERN] } },
    } as FiltersConfig;

    expect(createConfiguredContentInspector({ filters })).not.toBeNull();
    expect(fieldLengthReads).toBe(1);
    expect(fieldIteratorReads).toBe(0);

    for (const property of ["fields", "starterPatterns", "customPatterns"] as const) {
      let lengthReads = 0;
      let numericReads = 0;
      let iteratorReads = 0;
      const sparse = new Proxy(new Array<unknown>(10_000_000), {
        get(target, key, receiver) {
          if (key === "length") {
            lengthReads++;
          } else if (key === Symbol.iterator) {
            iteratorReads++;
            throw new Error("sparse iterator must not run");
          } else if (typeof key === "string" && /^\d+$/.test(key)) {
            numericReads++;
          }
          return Reflect.get(target, key, receiver);
        },
      });
      const pii = {
        fields: ["arguments"],
        starterPatterns: [],
        customPatterns: [BLOCK_PATTERN],
        [property]: sparse,
      };

      expect(() =>
        createConfiguredContentInspector({
          filters: { toolArguments: { pii } } as FiltersConfig,
        }),
      ).toThrow("may contain at most 256 entries");
      expect(lengthReads).toBe(1);
      expect(numericReads).toBe(0);
      expect(iteratorReads).toBe(0);
    }

    const { proxy: revokedFields, revoke } = Proxy.revocable([], {});
    revoke();
    expect(() =>
      createConfiguredContentInspector({
        filters: {
          toolArguments: {
            pii: { fields: revokedFields, starterPatterns: [], customPatterns: [BLOCK_PATTERN] },
          },
        } as FiltersConfig,
      }),
    ).toThrow("fields could not be inspected safely");
  });
});
