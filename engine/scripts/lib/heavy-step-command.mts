import path from "node:path";

/** Shared by native tooling and the runtime without importing a source-loader graph. */
export type HeavyStepKind = "build" | "typecheck" | "test";
export const DEFAULT_HEAVY_STEP_MEMORY_MB = { build: 4096, typecheck: 6144, test: 6144 };

/** Classify executable arguments, never quoted prose (for example echo or rg). */
export function resolveHeavyStepArgv(argv: readonly string[]): HeavyStepKind | undefined {
  const executable = path.win32.basename(argv[0] ?? "").replace(/\.(?:exe|cmd)$/iu, "");
  const args = argv.slice(1);
  if (["tsc", "tsgo"].includes(executable)) {
    return "typecheck";
  }
  if (["vitest", "jest"].includes(executable)) {
    return "test";
  }
  if (["npm", "pnpm", "yarn", "bun", "npx"].includes(executable)) {
    let index = 0;
    while (args[index]?.startsWith("-")) {
      index += ["-C", "--dir", "--prefix", "--filter", "-F"].includes(args[index]!) ? 2 : 1;
    }
    const verb = args[index];
    if (verb === "exec" || executable === "npx") {
      return resolveHeavyStepArgv(args.slice(index + (verb === "exec" ? 1 : 0)));
    }
    const script = verb === "run" || verb === "run-script" ? args[index + 1] : verb;
    if (/^(?:typecheck|check:types|tsc|tsgo)(?::|$)/u.test(script ?? "")) {
      return "typecheck";
    }
    if (/^build(?::|$)/u.test(script ?? "")) {
      return "build";
    }
    if (/^(?:test|vitest|jest)(?::|$)/u.test(script ?? "")) {
      return "test";
    }
  }
  if (["node", "bun"].includes(executable)) {
    if (args.includes("--test")) {
      return "test";
    }
    for (const arg of args) {
      const script = path.win32.basename(arg);
      if (
        /^(?:strict-typecheck|run-tsgo|run-tsgo-core-test-shards|window-typecheck)\.(?:mjs|mts)$/u.test(
          script,
        )
      ) {
        return "typecheck";
      }
      if (/^(?:run-vitest|run-vitest-child|run-vitest-project)\.(?:mjs|mts)$/u.test(script)) {
        return "test";
      }
      if (/^(?:build-all|tsdown-build|build-workspace-package)\.(?:mjs|mts)$/u.test(script)) {
        return "build";
      }
    }
  }
  return undefined;
}
