import { expect, it } from "vitest";
import { SESSION_TYPE_VALUES } from "../../packages/gateway-protocol/src/schema/sessions-row.js";
import { setRuntimeConfigSnapshot } from "../config/runtime-snapshot.js";
import {
  loadSessionEntryReadOnly,
  replaceSessionEntrySync,
} from "../config/sessions/session-accessor.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { retainSessionListForegroundWork } from "./session-projection-work.js";
import { createSessionRowProjection } from "./session-row-projection.js";
import { listProjectedSessions } from "./session-utils-list.js";

const cfg = { agents: { list: [{ id: "main", default: true }] } };
const key = (type: string) => `agent:main:dashboard:kind-${type}`;

function seedTypes() {
  setRuntimeConfigSnapshot(cfg);
  for (const [index, type] of ["legacy", ...SESSION_TYPE_VALUES].entries()) {
    replaceSessionEntrySync(
      { agentId: "main", sessionKey: key(type) },
      {
        sessionId: `kind-${type}`,
        updatedAt: index + 1,
        ...(type !== "legacy" ? { sessionType: type as SessionEntry["sessionType"] } : {}),
      },
    );
  }
}

async function assertCachedTypeLists(
  projection: Awaited<ReturnType<typeof createSessionRowProjection>>,
) {
  const normal = await listProjectedSessions({
    projection,
    opts: { limit: 1, includePeople: true, includeOwnerSessionCounts: true },
  });
  expect(normal.sessions.map((row) => row.key)).toEqual([key("scheduled")]);
  expect(normal).toMatchObject({ totalCount: 3, nextOffset: 1, peopleSessionCount: 3 });
  const acp = await listProjectedSessions({
    projection,
    opts: { sessionTypes: ["user", "scheduled", "acp"], limit: 1 },
  });
  expect(acp.sessions.map((row) => row.key)).toEqual([key("acp")]);
  expect(acp.totalCount).toBe(4);
  const hidden = await listProjectedSessions({
    projection,
    opts: { sessionTypes: ["hidden"] },
  });
  expect(hidden.sessions.map((row) => row.key)).toEqual([key("hidden")]);
  const again = await listProjectedSessions({ projection, opts: { limit: 1, offset: 1 } });
  expect(again.sessions.map((row) => row.key)).toEqual([key("user")]);
  expect(again.totalCount).toBe(3);
  expect((await listProjectedSessions({ projection, opts: { sessionTypes: [] } })).totalCount).toBe(
    0,
  );
  expect(
    (
      await listProjectedSessions({
        projection,
        opts: { sessionTypes: [...SESSION_TYPE_VALUES] },
      })
    ).totalCount,
  ).toBe(8);
}

it("filters native SQLite discovery before facets and pages, isolates cached type selections and cold reloads legacy User", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    seedTypes();
    const release = retainSessionListForegroundWork();
    const projection = await createSessionRowProjection({ cfg, modelCatalog: [] });
    try {
      await projection.ensureMaterialized();
      await assertCachedTypeLists(projection);
    } finally {
      projection.dispose();
      release();
    }
    const cold = await createSessionRowProjection({ cfg, modelCatalog: [] });
    try {
      await cold.ensureMaterialized();
      const legacy = await listProjectedSessions({
        projection: cold,
        opts: { search: key("legacy") },
      });
      expect(legacy.sessions).toMatchObject([{ key: key("legacy"), sessionType: "user" }]);
      expect(
        loadSessionEntryReadOnly({ agentId: "main", sessionKey: key("legacy") })?.sessionType,
      ).toBeUndefined();
    } finally {
      cold.dispose();
    }
  });
});
