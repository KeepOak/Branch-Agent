import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { groveContainedRelativePath } from "./path-containment.js";

describe("groveContainedRelativePath", () => {
  const root = resolve(sep, "grove-root");

  it("returns native relative paths only for strict descendants", () => {
    expect(groveContainedRelativePath(root, root)).toBeUndefined();
    expect(groveContainedRelativePath(root, join(root, "file.md"))).toBe("file.md");
    expect(groveContainedRelativePath(root, join(root, "nested", "file.md"))).toBe(
      join("nested", "file.md"),
    );
  });

  it.each([
    ["parent", join(root, "..", "outside.md")],
    ["prefix sibling", join(`${root}-sibling`, "file.md")],
  ])("rejects %s paths", (_name, target) => {
    expect(groveContainedRelativePath(root, target)).toBeUndefined();
  });

  it.runIf(process.platform === "win32")("rejects cross-drive and cross-UNC paths", () => {
    expect(groveContainedRelativePath("C:\\root", "D:\\root\\file.md")).toBeUndefined();
    expect(
      groveContainedRelativePath("\\\\server\\share\\root", "\\\\other\\share\\root\\file.md"),
    ).toBeUndefined();
  });
});
