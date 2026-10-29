// Settings › Coding: the approved preview's ten cards (preview.html PG coding), drawn from Classic Computer & browser's
// code and git section data (set2/computer-code.tsx, set2/computer-more.tsx) and Advanced's Commands and Files. Each
// Classic row becomes an R1 row on its card (spec-rows.tsx); a row Classic left out because Branch can't do it yet is a
// Coming row in its own words.
import { COMMANDS, FILES } from "../../../places/settings/set2/advanced-more";
import { CODE_SECS, CODE_TECH, COPIES_LINE, CopiesButton } from "../../../places/settings/set2/computer-code";
import { PART_SECS as S } from "../../../places/settings/set2/computer-more";
import { advanced } from "./browser";
import { ClassicBlock, specPage } from "./spec-rows";

const [CODE, CODE_MORE, KNOWS, GIT, CHECKS, BIG, SUGGEST, APPS] = CODE_SECS;

const PAGE = specPage("coding", [
  ["Code", [CODE, CODE_MORE, CODE_TECH]],
  ["What it knows about a project", [KNOWS]],
  ["Git", [GIT]],
  ["Checks before done", [CHECKS]],
  ["Big coding tasks", [BIG]],
  ["Suggestions while you edit", [SUGGEST]],
  ["Coding apps", [APPS]],
  ["Code and commits", [S.CODE_COMMITS]],
  ["Commands", [advanced(COMMANDS)]],
  ["Files", [advanced(FILES)]],
]);

/** Separate copies and Branches Branch is keeping read as the preview draws them: the label and its line on the left, the
 *  "See 2" button on the right, as other button rows (control "toggle" lays the row out inline). */
const COPIES: Record<string, "copies" | "branches"> = { "coding.code.separate-copies": "copies", "coding.code.branches-branch-is-keeping": "branches" };
export const CODING = {
  rows: PAGE.rows.map((r) => (COPIES[r.id] ? { ...r, bare: undefined, control: "toggle" as const, help: COPIES_LINE[COPIES[r.id]], source: { kind: "slot" as const, calls: ["worktrees.list"], reason: `${r.label} comes in a later update.` } } : r)),
  controls: { ...PAGE.controls, ...Object.fromEntries(Object.entries(COPIES).map(([id, mode]) => [id, (p: Parameters<typeof ClassicBlock>[0]) => <ClassicBlock {...p} draw={(c) => <CopiesButton c={c} mode={mode} />} />])) },
};
if (Object.keys(COPIES).some((id) => !PAGE.rows.some((r) => r.id === id))) throw new Error("Coding: a copies row id changed.");
