import {
  DEFAULT_HEAVY_STEP_MEMORY_MB,
  resolveHeavyStepArgv,
  type HeavyStepKind,
} from "../../scripts/lib/heavy-step-command.mts";
import { splitCommandArgs } from "../utils/shell-argv.js";
import { buildCommandPayloadArgvCandidates } from "./command-analysis/risks.js";

export { DEFAULT_HEAVY_STEP_MEMORY_MB, resolveHeavyStepArgv, type HeavyStepKind };

export function resolveHeavyStepCommand(
  command: string,
  memoryNeed: (kind: HeavyStepKind) => number = (kind) => DEFAULT_HEAVY_STEP_MEMORY_MB[kind],
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
