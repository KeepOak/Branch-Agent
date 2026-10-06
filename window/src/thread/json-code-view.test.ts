import { describe, expect, it } from "vitest";
import { parseJsonCode } from "./json-code-view";

describe("native source-preserving JSON parsing", () => {
  it("retains duplicate members, order, and numeric source offsets", () => {
    const source = '{"2":1.00,"1":1E+03,"a":9007199254740993,"a":1e400}';
    const root = parseJsonCode(source)!.root!;
    expect(root.children?.map(property => source.slice(property.children![0].offset, property.children![0].offset + property.children![0].length)))
      .toEqual(['"2"', '"1"', '"a"', '"a"']);
    expect(root.children?.map(property => source.slice(property.children![1].offset, property.children![1].offset + property.children![1].length)))
      .toEqual(['1.00', '1E+03', '9007199254740993', '1e400']);
  });
  it.each(['{"missing":}', '{"trailing":1,}', '{/*comment*/"a":1}', '{"a":1} trailing'])("keeps invalid JSON on Raw: %s", source => {
    expect(parseJsonCode(source)).toBeNull();
  });
  it.each(['['.repeat(1000) + '0' + ']'.repeat(1000), '[' + '0,'.repeat(3000) + '0]', ' '.repeat(20000) + '{}'])("retains complete Raw source beyond native tree budgets", source => {
    expect(parseJsonCode(source)).toEqual({ text: source });
  });
  it("counts braces inside string literals as text, and accepts root literals", () => {
    expect(parseJsonCode('{"text":"' + '['.repeat(100) + '"}')?.root).toBeDefined();
    expect(parseJsonCode('"hello"')?.root?.type).toBe("string");
    expect(parseJsonCode('null')?.root?.type).toBe("null");
  });
});
