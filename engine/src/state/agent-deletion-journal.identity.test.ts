import { expect, it } from "vitest";
import { parseCleanupPaths } from "./agent-deletion-journal.js";

// Pure JSON round-trip: no SQLite or temp directories, so it runs the same on Windows and POSIX.
it.each([
  { dev: "1311768467463790320", ino: "9223372036854775809" },
  { dev: 12, ino: 34 },
])("reads cleanup path identity from journal JSON: dev=$dev", ({ dev, ino }) => {
  const cleanupPath = {
    path: "/agent",
    canonicalPath: "/agent",
    parentPath: "/",
    kind: "target",
    sourcePaths: ["/agent"],
    dev,
    ino,
    coversDescendants: true,
    done: false,
  };
  expect(parseCleanupPaths(JSON.stringify([cleanupPath]))).toEqual([cleanupPath]);
});
