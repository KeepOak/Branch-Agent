import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_CLIENT_CAPS } from "../../../packages/gateway-protocol/src/client-info.js";
import type { SkillsGardenerLiveStatusResult } from "../../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import { createDeferred } from "../../../test/helpers/promise.js";
import { getSkillGardenerStatus } from "../../skills/workshop/gardener.js";
import { skillsGardenerHandlers } from "./skills-gardener.js";
import { callGatewayHandler } from "./skills.test-helpers.js";
import type { GatewayClient } from "./types.js";

vi.mock("../../skills/workshop/gardener.js", () => ({
  getSkillGardenerStatus: vi.fn(),
}));

const knownSkill: SkillsGardenerLiveStatusResult["skills"][number] = {
  skillFile: "/workspace/skills/known/SKILL.md",
  skillKey: "known",
  skillName: "Known",
  state: "active",
  pinned: false,
  createdAtMs: 100,
  stateChangedAtMs: 200,
  lastUsedAtMs: 300,
  useCount: 4,
  archivedReason: null,
};
const status: SkillsGardenerLiveStatusResult = {
  inventory: "live-workshop",
  lastAttemptAtMs: 400,
  lastSuccessAtMs: 500,
  lastError: null,
  collectionReview: {},
  experienceReview: {},
  counts: { active: 3, stale: 0, archived: 0 },
  skills: [
    knownSkill,
    { ...knownSkill, skillFile: "/workspace/skills/no-created/SKILL.md", createdAtMs: null },
    {
      ...knownSkill,
      skillFile: "/workspace/skills/no-changed/SKILL.md",
      stateChangedAtMs: null,
    },
  ],
  overlaps: [],
};

describe("skills gardener async status", () => {
  beforeEach(() => {
    vi.mocked(getSkillGardenerStatus).mockReset();
  });

  it.each([false, true])(
    "awaits status before replying with live inventory capability %s",
    async (live) => {
      const pendingStatus = createDeferred<SkillsGardenerLiveStatusResult>();
      vi.mocked(getSkillGardenerStatus).mockReturnValueOnce(pendingStatus.promise);
      const client: GatewayClient = {
        connect: {
          minProtocol: 1,
          maxProtocol: 1,
          client: { id: "cli", version: "test", platform: "test", mode: "cli" },
          role: "operator",
          scopes: ["operator.read"],
          caps: live ? [GATEWAY_CLIENT_CAPS.SKILL_GARDENER_LIVE_INVENTORY] : [],
        },
      };
      const completed = vi.fn();
      const request = callGatewayHandler(
        skillsGardenerHandlers,
        "skills.gardener.status",
        {},
        { client },
      ).then(
        (response) => {
          completed();
          return { response };
        },
        (error: unknown) => {
          completed();
          return { error };
        },
      );
      try {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        expect(completed).not.toHaveBeenCalled();
      } finally {
        pendingStatus.resolve(status);
      }
      const { inventory: _inventory, ...legacyStatus } = status;
      expect(await request).toEqual({
        response: {
          ok: true,
          response: live
            ? status
            : {
                ...legacyStatus,
                skills: [knownSkill],
                counts: { active: 1, stale: 0, archived: 0 },
              },
          error: undefined,
        },
      });
    },
  );

  it("propagates an asynchronous status failure", async () => {
    const error = new Error("gardener state unavailable");
    vi.mocked(getSkillGardenerStatus).mockRejectedValueOnce(error);

    await expect(
      callGatewayHandler(skillsGardenerHandlers, "skills.gardener.status", {}),
    ).rejects.toBe(error);
  });
});
