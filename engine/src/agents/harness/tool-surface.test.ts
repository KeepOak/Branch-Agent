import { expect, it } from "vitest";
import {
  agentHarnessBuildsBranchTools,
  agentHarnessExposesBranchTools,
} from "./tool-surface.js";

it.each([
  { harness: "branch", builds: false, exposes: true },
  { harness: "codex", builds: true, exposes: true },
  { harness: "copilot", builds: true, exposes: true },
  { harness: "custom", builds: false, exposes: false },
])("identifies the $harness tool surface", ({ harness, builds, exposes }) => {
  expect(agentHarnessBuildsBranchTools(harness)).toBe(builds);
  expect(agentHarnessExposesBranchTools(harness)).toBe(exposes);
});
