// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/adapters/nested.spec.ts (atlas SAFETY-0062)
import { describe, expect, it, vi } from "vitest";
import { CONTENT_TRAVERSAL_MAX_NODES, visitNestedStrings } from "./nested.js";

describe("visitNestedStrings", () => {
  it.each([Number.NaN, -1])(
    "fails closed for an invalid array length %s without dispatching its iterator",
    (invalidLength) => {
      let iteratorReads = 0;
      const value = new Proxy(["PRIVATE-NESTED"], {
        get(target, property, receiver) {
          if (property === "length") {
            return invalidLength;
          }
          if (property === Symbol.iterator) {
            iteratorReads++;
            throw new Error("nested iterator must not run");
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const onString = vi.fn();

      expect(visitNestedStrings(value, "/value", onString)).toBe(false);
      expect(onString).not.toHaveBeenCalled();
      expect(iteratorReads).toBe(0);
    },
  );

  it("captures an array length once before bounded numeric traversal", () => {
    let lengthReads = 0;
    const value = new Proxy(["retained"], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads++;
          return lengthReads === 1 ? 1 : Number.NaN;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const values: string[] = [];

    expect(visitNestedStrings(value, "/value", (text) => values.push(text))).toBe(true);
    expect(values).toEqual(["retained"]);
    expect(lengthReads).toBe(1);
  });

  it("bounds traversal at CONTENT_TRAVERSAL_MAX_NODES visited nodes", () => {
    const leaves = (count: number) => Array.from({ length: count }, (_, index) => `leaf ${index}`);
    const visit = (value: unknown) => {
      let visited = 0;
      const complete = visitNestedStrings(value, "/value", () => {
        visited++;
      });
      return { complete, visited };
    };

    expect(visit(leaves(CONTENT_TRAVERSAL_MAX_NODES - 1))).toEqual({
      complete: true,
      visited: CONTENT_TRAVERSAL_MAX_NODES - 1,
    });
    expect(visit(leaves(CONTENT_TRAVERSAL_MAX_NODES)).complete).toBe(false);
  });

  it("addresses leaves by escaped JSON pointer and fails closed beyond the depth budget", () => {
    const paths: string[] = [];
    expect(
      visitNestedStrings({ "a/b": { "c~d": ["x"] } }, "/arguments", (_text, path) =>
        paths.push(path),
      ),
    ).toBe(true);
    expect(paths).toEqual(["/arguments/a~1b/c~0d/0"]);

    let deep: unknown = "too deep";
    for (let depth = 0; depth < 30; depth++) {
      deep = { next: deep };
    }
    expect(visitNestedStrings(deep, "/arguments", () => {})).toBe(false);
  });
});
