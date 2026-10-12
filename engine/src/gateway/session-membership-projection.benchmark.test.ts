import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import { isSessionMember } from "../config/sessions/session-sharing-store.js";
import { addSessionMember } from "../config/sessions/session-sharing-store.native.js";
import { readBranchAgentDatabaseIdentity } from "../state/branch-agent-db-identity.js";
import {
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "../state/branch-agent-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { readSessionGroupMembership } from "./session-group-membership.read.js";
import { createSessionMembershipProjection } from "./session-membership-projection.js";

it.runIf(process.env.BRANCH_MEMBERSHIP_BENCH === "1")(
  "measures 5,000 sessions and 50 viewers with native result goldens",
  async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      runBranchAgentWriteTransaction(
        (database) => {
          for (let index = 0; index < 5_000; index++) {
            const sessionKey = `agent:main:membership-${String(index).padStart(4, "0")}`;
            writeSessionEntry(
              database,
              sessionKey,
              {
                sessionId: `membership-${index}`,
                updatedAt: index + 1,
                category: `Group ${index % 20}`,
              },
              { previousEntry: null, canonicalPreviousEntry: null },
            );
            addSessionMember(
              { agentId: "main", sessionKey },
              { identityId: `viewer-${index % 50}`, addedBy: "owner", addedAt: 1 },
            );
          }
        },
        { agentId: "main" },
      );
      const database = openBranchAgentDatabase({ agentId: "main" });
      const scope = {
        agentId: "main",
        storePath: database.path,
        sessionKey: "agent:main:membership-0000",
      };
      const projection = createSessionMembershipProjection();
      projection.updateTargets([
        {
          agentId: "main",
          storePath: database.path,
          ...readBranchAgentDatabaseIdentity(database),
        },
      ]);
      const measure = async (read: () => unknown, count = 50, minMs = 0) => {
        const cpu = process.threadCpuUsage(),
          wall = performance.now();
        let calls = 0;
        do {
          await read();
          calls++;
        } while (calls < count || performance.now() - wall < minMs);
        const elapsed = process.threadCpuUsage(cpu);
        return {
          cpuMs: (elapsed.user + elapsed.system) / 1_000 / calls,
          wallMs: (performance.now() - wall) / calls,
        };
      };
      const median = (values: number[]) =>
        values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;
      try {
        const initial = await measure(() => projection.prepare(), 1);
        const nativeGroups = () => new Map(readSessionGroupMembership({}, process.env).groups);
        const projectedGroups = () => projection.groupTargets();
        const nativeMember = () => isSessionMember(scope, "viewer-0");
        const projectedMember = () =>
          projection.membership(scope.storePath, scope.sessionKey)?.includes("viewer-0") ?? false;
        expect(
          JSON.stringify([...projectedGroups()]) === JSON.stringify([...nativeGroups()]),
          "group discovery must remain byte-identical",
        ).toBe(true);
        expect(projectedMember()).toBe(nativeMember());
        for (const [name, before, after] of [
          ["groups", nativeGroups, projectedGroups],
          ["member", nativeMember, projectedMember],
        ] as const) {
          await measure(before, 50, 150);
          await measure(after, 50, 150);
          const native = [],
            projected = [];
          for (let round = 0; round < 5; round++) {
            native.push(await measure(before, 50, 150));
            projected.push(await measure(after, 50, 150));
          }
          console.info(
            JSON.stringify({
              benchmark: name,
              sessions: 5_000,
              viewers: 50,
              beforeCpuMs: median(native.map((value) => value.cpuMs)),
              afterCpuMs: median(projected.map((value) => value.cpuMs)),
              beforeWallMs: median(native.map((value) => value.wallMs)),
              afterWallMs: median(projected.map((value) => value.wallMs)),
            }),
          );
        }
        const nativeRevision = await measure(() => {
          for (let viewer = 0; viewer < 50; viewer++) {
            nativeGroups();
            nativeMember();
          }
        }, 5);
        const revision = await measure(async () => {
          projection.invalidate({
            storePath: database.path,
            sessionKey: scope.sessionKey,
            factsInvalidated: true,
          });
          await Promise.all(Array.from({ length: 50 }, () => projection.prepare()));
          for (let viewer = 0; viewer < 50; viewer++) {
            projectedGroups();
            projectedMember();
          }
        }, 5);
        console.info(
          JSON.stringify({
            benchmark: "revision-refresh-plus-50-viewers",
            initial,
            nativeRevision,
            revision,
          }),
        );
      } finally {
        projection.dispose();
      }
    });
  },
);
