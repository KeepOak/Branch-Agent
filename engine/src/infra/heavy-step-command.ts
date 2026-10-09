import path from "node:path";
import { splitCommandArgs } from "../utils/shell-argv.js";
import { buildCommandPayloadArgvCandidates } from "./command-analysis/risks.js";

export type HeavyStepKind = "build" | "typecheck" | "test";

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

export function resolveHeavyStepCommand(
  command: string,
  memoryNeed: (kind: HeavyStepKind) => number = (kind) =>
    ({ test: 1, build: 2, typecheck: 3 })[kind],
): HeavyStepKind | undefined {
  // Keep quoted separators in their word; inspect each actual command in a chain.
  const segments = command.match(/(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s;&|])+|[;&|\r\n]+/gu) ?? [];
  let words: string[] = [];
  let selected: HeavyStepKind | undefined;
  const inspect = () => {
    const argv = splitCommandArgs(words.join(" "));
    return argv && buildCommandPayloadArgvCandidates(argv).map(resolveHeavyStepArgv).find(Boolean);
  };
  for (const token of [...segments, ";"]) {
    if (/^[;&|\r\n]+$/u.test(token)) {
      const kind = inspect();
      if (kind && (!selected || memoryNeed(kind) > memoryNeed(selected))) {
        selected = kind;
      }
      words = [];
    } else {
      words.push(token);
    }
  }
  return selected;
}
