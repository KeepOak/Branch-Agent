// Settings › Coding: the approved preview's ten cards (preview.html PG coding), drawn from Classic Computer & browser's
// code and git section data (set2/computer-code.tsx, set2/computer-more.tsx) and Advanced's Commands and Files. Each
// Classic row becomes an R1 row on its card (spec-rows.tsx); a row Classic left out because Branch can't do it yet is a
// Coming row in its own words.
import { COMMANDS, FILES } from "../../../places/settings/set2/advanced-more";
import { CODE_SECS, CODE_TECH } from "../../../places/settings/set2/computer-code";
import { PART_SECS as S } from "../../../places/settings/set2/computer-more";
import { advanced } from "./browser";
import { specPage } from "./spec-rows";

const [CODE, CODE_MORE, KNOWS, GIT, CHECKS, BIG, SUGGEST, APPS] = CODE_SECS;

export const CODING = specPage("coding", [
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
