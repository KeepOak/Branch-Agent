import { expectTypeOf } from "vitest";
import type {
  CanopyBoardMetadata,
  CanopyBoardSummary,
} from "../../packages/canopy-contract/src/index.js";

// canopy board automation contract
// carries the owning automation job reference in metadata and summaries
const metadata: CanopyBoardMetadata = {
  id: "planning",
  automationJobId: "job-categorize-planning",
  createdAt: 1,
  updatedAt: 1,
};
const summary: CanopyBoardSummary = {
  id: metadata.id,
  automationJobId: metadata.automationJobId,
  total: 0,
  active: 0,
  archived: 0,
  byStatus: {},
};

expectTypeOf(summary.automationJobId).toEqualTypeOf<string | undefined>();
