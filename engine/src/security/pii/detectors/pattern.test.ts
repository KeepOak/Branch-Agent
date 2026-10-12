// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/detectors/pattern.spec.ts (atlas SAFETY-0062)
import { describe, expect, it } from "vitest";
import type { FilterPiiConfig } from "../filters.js";
import type { TextContentFragment } from "../types.js";
import {
  createPatternContentInspector,
  getPatternContentInspectorResourceCost,
  PatternConfigurationError,
} from "./pattern.js";

function fragment(text: string): TextContentFragment {
  return {
    id: "tool-call.arguments",
    text,
    path: "/arguments/text",
    source: "tool_argument",
    field: "arguments",
    format: "plain",
    treatment: "replaceable",
    provenance: "user",
  };
}

describe("pattern content inspector", () => {
  it("deduplicates identical regexes while retaining the first declaration metadata", () => {
    const config: FilterPiiConfig = {
      starterPatterns: [],
      customPatterns: [
        { id: "first", label: "First declaration", regex: "SHARED-[0-9]+" },
        { id: "second", label: "Second declaration", regex: "SHARED-[0-9]+" },
      ],
    };

    expect(
      createPatternContentInspector(config).inspectFragment(fragment("SHARED-42")),
    ).toMatchObject({ ruleId: "first", label: "First declaration" });
    expect(getPatternContentInspectorResourceCost(config).validCustomPatterns).toBe(1);
  });

  it("preserves declaration order when multiple custom regexes match", () => {
    const config: FilterPiiConfig = {
      starterPatterns: [],
      customPatterns: [
        { id: "broad", label: "Broad", regex: "ORDER" },
        { id: "specific", label: "Specific", regex: "ORDER-[0-9]+" },
      ],
    };

    expect(
      createPatternContentInspector(config).inspectFragment(fragment("ORDER-42")),
    ).toMatchObject({
      ruleId: "broad",
    });
  });

  it("keeps starter-pattern precedence and matching semantics", () => {
    const config: FilterPiiConfig = {
      starterPatterns: ["bearer_header"],
      customPatterns: [{ id: "custom", label: "Custom", regex: "bearer [^ ]+" }],
    };

    expect(
      createPatternContentInspector(config).inspectFragment(
        fragment("Authorization: bEaReR contract-token"),
      ),
    ).toMatchObject({ ruleId: "bearer_header" });
  });

  it.each([
    { config: { starterPatterns: ["bearer_header"] }, text: "Bearer contract-token" },
    {
      config: {
        starterPatterns: [],
        customPatterns: [{ id: "custom", label: "Custom", regex: "ORG-[A-Z]+" }],
      },
      text: "ORG-SECRET",
    },
  ] satisfies { config: FilterPiiConfig; text: string }[])(
    "enforces a zero remaining allowance when locating $text",
    ({ config, text }) => {
      const inspector = createPatternContentInspector(config);

      expect(inspector.locate("clean text", 0)).toEqual([]);
      expect(inspector.locate("", 0)).toEqual([]);
      expect(() => inspector.locate(text, 0)).toThrow(PatternConfigurationError);
      expect(inspector.locate(text, 1)).toHaveLength(1);
    },
  );

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid remaining match allowance %s before inspecting",
    (allowance) => {
      const inspector = createPatternContentInspector({});
      expect(() => inspector.locate("clean text", allowance)).toThrow(PatternConfigurationError);
    },
  );

  it("memoizes a compiled inspector by config identity", () => {
    const config: FilterPiiConfig = {
      starterPatterns: [],
      customPatterns: [{ id: "cached", label: "Cached", regex: "CACHE-IDENTITY-[0-9]+" }],
    };

    const first = createPatternContentInspector(config);
    const second = createPatternContentInspector(config);
    const otherIdentity = createPatternContentInspector({ ...config });

    expect(second).toBe(first);
    expect(otherIdentity).not.toBe(first);
  });

  it("reads bounded config arrays numerically without dispatching their iterators", () => {
    let lengthReads = 0;
    let numericReads = 0;
    let iteratorReads = 0;
    const customPatterns = new Proxy(
      [{ id: "numeric", label: "Numeric", regex: "NUMERIC-[0-9]+" }],
      {
        get(target, property, receiver) {
          if (property === "length") {
            lengthReads++;
          } else if (property === Symbol.iterator) {
            iteratorReads++;
            throw new Error("custom iterator must not run");
          } else if (typeof property === "string" && /^\d+$/.test(property)) {
            numericReads++;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const config = { starterPatterns: [], customPatterns } as FilterPiiConfig;

    const first = createPatternContentInspector(config);
    const second = createPatternContentInspector(config);

    expect(second).toBe(first);
    expect(lengthReads).toBe(1);
    expect(numericReads).toBe(1);
    expect(iteratorReads).toBe(0);
  });

  it.each(["starterPatterns", "customPatterns", "customPattern"] as const)(
    "normalizes a revoked %s proxy to a configuration error",
    (candidate) => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      let config: Record<string, unknown>;
      if (candidate === "starterPatterns") {
        config = { starterPatterns: proxy };
      } else if (candidate === "customPatterns") {
        config = { starterPatterns: [], customPatterns: proxy };
      } else {
        config = { starterPatterns: [], customPatterns: [proxy] };
      }

      expect(() => createPatternContentInspector(config as FilterPiiConfig)).toThrow(
        PatternConfigurationError,
      );
    },
  );
});
