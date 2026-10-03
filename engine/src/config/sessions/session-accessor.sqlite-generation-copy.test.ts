import { expect, it } from "vitest";
import { runBranchAgentWriteTransaction } from "../../state/branch-agent-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { copySqliteSessionGenerationRows } from "./session-accessor.sqlite-generation-copy.js";
import { appendTranscriptEventsInTransaction } from "./session-accessor.sqlite-transcript-store.js";

it("rejects a streaming copy onto its source before deleting any rows", async () => {
  await withBranchTestState({ label: "generation-self-copy" }, async (state) => {
    const scope = {
      agentId: "main",
      env: state.env,
      sessionKey: "agent:main:copy",
      sessionId: "copy",
    };
    runBranchAgentWriteTransaction(
      (database) => {
        appendTranscriptEventsInTransaction(database, scope, [
          { type: "session", version: 3, id: scope.sessionId },
          {
            type: "message",
            id: "message",
            parentId: null,
            message: { role: "user", content: "Preserve these exact bytes." },
          },
        ]);
        const snapshot = () => ({
          events: database.db.prepare("SELECT * FROM transcript_events ORDER BY seq").all(),
          identities: database.db
            .prepare("SELECT * FROM transcript_event_identities ORDER BY event_id")
            .all(),
        });
        const before = snapshot();
        expect(before.events).toHaveLength(2);
        expect(() =>
          copySqliteSessionGenerationRows({
            destination: database,
            source: database,
            sessionId: scope.sessionId,
            sourceWindowPresent: true,
          }),
        ).toThrow("requires distinct source and destination databases");
        expect(snapshot()).toEqual(before);
      },
      { agentId: scope.agentId, env: scope.env },
    );
  });
});
