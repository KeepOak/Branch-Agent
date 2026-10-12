/** Portable, bounded verification; optional read-only reuse of existing installed dependencies. */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const deps = process.env.BRANCH_TOOLS_TEST_DEPS;
export default {
  root,
  resolve: {
    alias: [
      {
        find: /^@branch\/normalization-core$/,
        replacement: path.join(root, "packages/normalization-core/src/index.ts"),
      },
      {
        find: /^@branch\/normalization-core\/(.*)$/,
        replacement: path.join(root, "packages/normalization-core/src/$1.ts"),
      },
      ...(deps
        ? [
            { find: /^vitest$/, replacement: path.join(deps, "vitest/dist/index.js") },
            { find: /^diff$/, replacement: path.join(deps, "diff/libesm/index.js") },
            {
              find: /^@modelcontextprotocol\/sdk\/(.*)$/,
              replacement: path.join(deps, "@modelcontextprotocol/sdk/dist/esm/$1"),
            },
          ]
        : []),
    ],
  },
  test: {
    include: [
      "src/agents/tools/arithmetic.test.ts",
      "src/agents/tools/calculator-tool.test.ts",
      "src/agents/omission-placeholder-detector.test.ts",
      "src/agents/sessions/tools/file-omission-planning.test.ts",
      "src/agents/sessions/tools/edit-diff.test.ts",
      "src/agents/mcp-compliance-transport.test.ts",
      "src/agents/mcp-compliance-sdk.test.ts",
      "src/agents/tools/sequential-thinking-tool.test.ts",
      "src/agents/tools/weather-api.test.ts",
      "src/agents/tools/weather-tool.test.ts",
      "src/agents/tools/harvested-tools-catalog.test.ts",
      "src/agents/tools/harvested-tools-construction.test.ts",
      "src/agents/mcp-name-transform.test.ts",
      "src/agents/mcp-names.stability.test.ts",
      "src/agents/agent-bundle-mcp-names.test.ts",
    ],
    maxWorkers: 1,
    fileParallelism: false,
    isolate: false,
    pool: "forks",
    testTimeout: 5000,
  },
};
