import { describe, expect, it } from "vitest";
import { prepareFileEdit } from "./edit-diff.js";
import { prepareFileWriteDiff } from "./file-diff.js";

describe("source omission validation in production file planning", () => {
  it.each([true, false])("rejects incomplete write content with created=%s", (created) => {
    expect(() =>
      prepareFileWriteDiff({
        path: "module.ts",
        content: "function run() {}\n(rest of methods ...)\n",
        beforeText: "old\n",
        created,
      }),
    ).toThrow(/omission placeholder/);
  });
  it("validates write content even when no old text exists for a diff receipt", () => {
    expect(() =>
      prepareFileWriteDiff({ path: "module.ts", content: "// rest of code ...\n" }),
    ).toThrow(/omission placeholder/);
  });
  it("rejects newly introduced placeholders before returning an edit plan", () => {
    expect(() =>
      prepareFileEdit(
        "const a = 1;\nconst b = 2;\n",
        [{ oldText: "const b = 2;", newText: "(unchanged code ...)" }],
        "module.ts",
      ),
    ).toThrow(/omission placeholder/);
  });
  it("validates every edit in a batch before a mutation plan can be returned", () => {
    expect(() =>
      prepareFileEdit(
        "const a = 1;\nconst b = 2;\n",
        [
          { oldText: "const a = 1;", newText: "const a = 3;" },
          { oldText: "const b = 2;", newText: "// rest of methods ..." },
        ],
        "module.ts",
      ),
    ).toThrow(/omission placeholder/);
  });
  it("allows an existing normalized placeholder in the source replacement", () => {
    const plan = prepareFileEdit(
      "// Rest Of Code ...\nconst a = 1;\n",
      [
        {
          oldText: "// Rest Of Code ...\nconst a = 1;",
          newText: "// rest of code ...\nconst a = 2;",
        },
      ],
      "module.ts",
    );
    expect(plan).toMatchObject({ changed: true, content: "// rest of code ...\nconst a = 2;\n" });
  });
  it("does not mistake quoted or inline omission phrases for standalone placeholders", () => {
    const content = 'const note = "(rest of methods ...)";\nreturn note; // rest of code ...\n';
    expect(prepareFileWriteDiff({ path: "module.ts", content, created: true })).toBeDefined();
    expect(
      prepareFileEdit(
        "const a = 1;\n",
        [{ oldText: "const a = 1;", newText: content }],
        "module.ts",
      ),
    ).toMatchObject({ changed: true });
  });
  it("rejects introducing a different placeholder even if the original has one", () => {
    expect(() =>
      prepareFileEdit(
        "// rest of methods ...\n",
        [
          {
            oldText: "// rest of methods ...",
            newText: "// rest of code ...",
          },
        ],
        "module.ts",
      ),
    ).toThrow(/omission placeholder/);
  });
  it("preserves existing CRLF/BOM behavior for complete edits", () => {
    expect(
      prepareFileEdit(
        "\uFEFFconst a = 1;\r\n",
        [{ oldText: "const a = 1;", newText: "const a = 2;" }],
        "module.ts",
      ),
    ).toMatchObject({ content: "\uFEFFconst a = 2;\r\n" });
  });
});
