import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { cleanupSessionLifecycleArtifacts } from "branch/plugin-sdk/session-store-runtime";

const RINGS_SESSION_KEY_PREFIX = "rings-narrative-";
export const RINGS_ORPHAN_MIN_AGE_MS = 300_000;
const RINGS_TRANSCRIPT_RUN_MARKER = '"runId":"rings-narrative-';

export async function scrubRingsNarrativeArtifacts(params: {
  agentId: string;
  config: BranchConfig;
  logger: { info: (message: string) => void };
  nowMs?: number;
}): Promise<void> {
  const result = await cleanupSessionLifecycleArtifacts({
    agentId: params.agentId,
    archiveRemovedEntryTranscripts: false,
    orphanTranscriptMinAgeMs: RINGS_ORPHAN_MIN_AGE_MS,
    pluginOwnerId: "memory-core",
    sessionStore: params.config.session?.store,
    sessionKeySegmentPrefix: RINGS_SESSION_KEY_PREFIX,
    transcriptContentMarker: RINGS_TRANSCRIPT_RUN_MARKER,
    ...(params.nowMs === undefined ? {} : { nowMs: params.nowMs }),
  });
  const prunedEntries = result.removedEntries;
  const archivedOrphans = result.archivedTranscriptArtifacts;
  if (prunedEntries > 0 || archivedOrphans > 0) {
    params.logger.info(
      `memory-core: rings cleanup scrubbed ${prunedEntries} stale session entr${prunedEntries === 1 ? "y" : "ies"} and archived ${archivedOrphans} orphan transcript${archivedOrphans === 1 ? "" : "s"}.`,
    );
  }
}
