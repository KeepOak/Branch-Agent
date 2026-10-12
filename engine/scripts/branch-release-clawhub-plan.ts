#!/usr/bin/env -S node --import tsx
// Branch Agent release Seedbank plan CLI emits release workflow routing as JSON.

import { pathToFileURL } from "node:url";
import {
  buildBranchReleaseClawHubPlan,
  parseBranchReleaseClawHubPlanArgs,
} from "./lib/branch-release-clawhub-plan.ts";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseBranchReleaseClawHubPlanArgs(process.argv.slice(2));
  const plan = await buildBranchReleaseClawHubPlan(args);
  console.log(JSON.stringify(plan, null, 2));
}
