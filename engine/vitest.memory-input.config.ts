// Only the ChatGPT filesystem-reader checks; no engine/SQLite bootstrap.
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
export default {
  root: repoRoot,
  resolve: {
    alias: [
      {
        find: /^branch\/plugin-sdk\/(.+)$/,
        replacement: path.join(repoRoot, "src/plugin-sdk/$1.ts"),
      },
      {
        find: /^@branch\/normalization-core\/(.+)$/,
        replacement: path.join(repoRoot, "packages/normalization-core/src/$1.ts"),
      },
      {
        find: "@branch/normalization-core",
        replacement: path.join(repoRoot, "packages/normalization-core/src/index.ts"),
      },
    ],
  },
  test: {
    include: ["extensions/memory-wiki/src/chatgpt-export-input.test.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    testTimeout: 5000,
    hookTimeout: 5000,
  },
};
