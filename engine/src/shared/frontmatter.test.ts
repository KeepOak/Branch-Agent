// Frontmatter tests cover shared Markdown frontmatter parsing helpers.
import { expectDefined } from "@branch/normalization-core";
import { describe, expect, it, test } from "vitest";
import {
  applyBranchManifestInstallCommonFields,
  parseFrontmatterBool,
  parseBranchManifestInstallBase,
  resolveBranchManifestBlock,
  resolveBranchManifestInstall,
  resolveBranchManifestOs,
  resolveBranchManifestRequires,
} from "./frontmatter.js";

describe("shared/frontmatter", () => {
  test("parseFrontmatterBool respects explicit values and fallback", () => {
    expect(parseFrontmatterBool("true", false)).toBe(true);
    expect(parseFrontmatterBool("false", true)).toBe(false);
    expect(parseFrontmatterBool(undefined, true)).toBe(true);
    expect(parseFrontmatterBool("maybe", false)).toBe(false);
  });

  test("resolveBranchManifestBlock reads current manifest keys and custom metadata fields", () => {
    expect(
      resolveBranchManifestBlock({
        frontmatter: {
          metadata: "{ branch: { foo: 1, bar: 'baz' } }",
        },
      }),
    ).toEqual({ foo: 1, bar: "baz" });

    expect(
      resolveBranchManifestBlock({
        frontmatter: {
          pluginMeta: "{ anotherTool: { foo: 99 }, branch: { foo: 2 } }",
        },
        key: "pluginMeta",
      }),
    ).toEqual({ foo: 2 });
  });

  test("resolveBranchManifestBlock returns undefined for invalid input", () => {
    expect(resolveBranchManifestBlock({ frontmatter: {} })).toBeUndefined();
    expect(
      resolveBranchManifestBlock({ frontmatter: { metadata: "not-json5" } }),
    ).toBeUndefined();
    expect(resolveBranchManifestBlock({ frontmatter: { metadata: "123" } })).toBeUndefined();
    expect(resolveBranchManifestBlock({ frontmatter: { metadata: "[]" } })).toBeUndefined();
    expect(
      resolveBranchManifestBlock({ frontmatter: { metadata: "{ nope: { a: 1 } }" } }),
    ).toBeUndefined();
  });

  it("normalizes manifest requirement and os lists", () => {
    expect(
      resolveBranchManifestRequires({
        requires: {
          bins: "bun, node",
          anyBins: [" ffmpeg ", ""],
          env: ["BRANCH_TOKEN", " BRANCH_URL "],
          config: null,
        },
      }),
    ).toEqual({
      bins: ["bun", "node"],
      anyBins: ["ffmpeg"],
      env: ["BRANCH_TOKEN", "BRANCH_URL"],
      config: [],
    });
    expect(resolveBranchManifestRequires({})).toBeUndefined();
    expect(resolveBranchManifestOs({ os: [" darwin ", "linux", ""] })).toEqual([
      "darwin",
      "linux",
    ]);
  });

  it("parses and applies install common fields", () => {
    const parsed = parseBranchManifestInstallBase(
      {
        type: " Brew ",
        id: "brew.git",
        label: "Git",
        bins: [" git ", "git"],
      },
      ["brew", "npm"],
    );

    expect(parsed).toEqual({
      raw: {
        type: " Brew ",
        id: "brew.git",
        label: "Git",
        bins: [" git ", "git"],
      },
      kind: "brew",
      id: "brew.git",
      label: "Git",
      bins: ["git", "git"],
    });
    expect(parseBranchManifestInstallBase({ kind: "bad" }, ["brew"])).toBeUndefined();
    expect(
      applyBranchManifestInstallCommonFields<{
        extra: boolean;
        id?: string;
        label?: string;
        bins?: string[];
      }>({ extra: true }, expectDefined(parsed, "manifest install base")),
    ).toEqual({
      extra: true,
      id: "brew.git",
      label: "Git",
      bins: ["git", "git"],
    });
  });

  it("prefers explicit kind, ignores invalid common fields, and leaves missing ones untouched", () => {
    const parsed = parseBranchManifestInstallBase(
      {
        kind: " npm ",
        type: "brew",
        id: 42,
        label: null,
        bins: [" ", ""],
      },
      ["brew", "npm"],
    );

    expect(parsed).toEqual({
      raw: {
        kind: " npm ",
        type: "brew",
        id: 42,
        label: null,
        bins: [" ", ""],
      },
      kind: "npm",
    });
    expect(
      applyBranchManifestInstallCommonFields(
        { id: "keep", label: "Keep", bins: ["bun"] },
        parsed!,
      ),
    ).toEqual({
      id: "keep",
      label: "Keep",
      bins: ["bun"],
    });
  });

  it("maps install entries through the parser and filters rejected specs", () => {
    expect(
      resolveBranchManifestInstall(
        {
          install: [{ id: "keep" }, { id: "drop" }, "bad"],
        },
        (entry) => {
          if (
            typeof entry === "object" &&
            entry !== null &&
            (entry as { id?: string }).id === "keep"
          ) {
            return { id: "keep" };
          }
          return undefined;
        },
      ),
    ).toEqual([{ id: "keep" }]);
  });
});
