import "../../test/host.setup.ts";
import { expect, it } from "vitest";
import { getCanopyLifecycle } from "./lifecycle.ts";
import { createGatewaySession, createCanopyCard } from "./test/index-helpers.ts";

const localKey = "subagent:canopy-default-card-1";

it.each([
  {
    name: "an explicit link to a different agent",
    linkedKey: `agent:worker:${localKey}`,
    sessionKeys: [`agent:other:${localKey}`],
  },
  {
    name: "an ambiguous agentless link",
    linkedKey: localKey,
    sessionKeys: [`agent:worker:${localKey}`, `agent:other:${localKey}`],
  },
  {
    name: "one provisional match in a filtered roster",
    linkedKey: localKey,
    sessionKeys: [`agent:worker:${localKey}`],
  },
])("keeps $name unresolved", ({ linkedKey, sessionKeys }) => {
  const card = createCanopyCard({ sessionKey: linkedKey });
  const sessions = sessionKeys.map((key) => createGatewaySession({ key }));
  expect(getCanopyLifecycle(card, sessions)).toEqual({ session: null, state: "unknown" });
});

it("uses only the current session for lifecycle even when a historical attempt is still loaded", () => {
  const previous = createGatewaySession({ key: "agent:main:previous", status: "failed" });
  const current = createGatewaySession({
    key: `agent:main:${localKey}`,
    status: "done",
    hasActiveRun: false,
  });
  const card = createCanopyCard({
    sessionKey: localKey,
    metadata: {
      attempts: [{ id: "previous", status: "failed", startedAt: 1, sessionKey: previous.key }],
    },
  });
  expect(getCanopyLifecycle(card, [previous])).toEqual({ session: null, state: "unknown" });
  expect(
    getCanopyLifecycle(card, [previous], {
      key: localKey,
      status: "resolved",
      session: current,
    }),
  ).toMatchObject({
    session: current,
    state: "succeeded",
  });
});
