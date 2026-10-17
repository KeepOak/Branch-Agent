import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { resetConfigRuntimeState, setRuntimeConfigSnapshot } from "../config/config.js";
import {
  appendTranscriptMessageSync,
  replaceSessionEntrySync,
} from "../config/sessions/session-accessor.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { createSessionRowProjection } from "./session-row-projection.js";
import { listProjectedSessions } from "./session-utils-list.js";

afterEach(() => {
  resetConfigRuntimeState();
  resetPluginRuntimeStateForTest();
  vi.restoreAllMocks();
});

test.each([false, true])(
  "derives persisted conversation titles beyond row 100 with previews requested=%s",
  async (includeLastMessage) => {
    await withBranchTestState({ label: "selected-session-titles" }, async (state) => {
      const cfg: BranchConfig = {
        agents: { entries: { main: {} }, defaults: { thinkingDefault: "off" } },
      };
      setRuntimeConfigSnapshot(cfg);
      setActivePluginRegistry(createEmptyPluginRegistry());
      const count = 150;
      const offset = 10;
      const limit = 125;
      const storePath = path.join(state.sessionsDir(), "sessions.json");
      for (let index = 0; index < count; index++) {
        const sessionId = `selected-title-${index}`;
        const scope = {
          agentId: "main",
          sessionKey: `agent:main:${sessionId}`,
          sessionId,
          storePath,
        };
        replaceSessionEntrySync(scope, {
          sessionId,
          updatedAt: count - index,
          displayName: `Plan garden ${index}.`,
        });
        for (const message of [
          { role: "user", content: `Plan garden ${index}.` },
          { role: "assistant", content: `Garden response ${index}.` },
        ]) {
          expect(appendTranscriptMessageSync(scope, { message }).ok).toBe(true);
        }
      }
      const projection = await createSessionRowProjection({ cfg });
      try {
        // Transcript previews are backfilled asynchronously; compare settled facts.
        await vi.waitFor(
          () => {
            for (let index = offset; index < offset + limit; index++) {
              expect(
                projection.snapshot(
                  { agentId: "main", key: `agent:main:selected-title-${index}` },
                  { includeLastMessage: true },
                ).row?.lastMessagePreview,
              ).toBe(`Garden response ${index}.`);
            }
          },
          { timeout: 10_000 },
        );
        const opts = { offset, limit, includeDerivedTitles: true, includeLastMessage };
        const result = await listProjectedSessions({ projection, opts });
        expect(result).toMatchObject({
          totalCount: count,
          offset,
          nextOffset: offset + limit,
          hasMore: true,
        });
        expect(result.sessions).toHaveLength(limit);
        for (const [index, row] of result.sessions.entries()) {
          expect(row.key).toBe(`agent:main:selected-title-${offset + index}`);
          expect(row.derivedTitle).toBe(`Plan garden ${offset + index}.`);
          expect(row.lastMessagePreview).toBe(
            includeLastMessage && index < 100 ? `Garden response ${offset + index}.` : undefined,
          );
        }
        expect(result.sessions[100]?.derivedTitle).toBe("Plan garden 110.");
        expect(result.sessions.at(-1)?.derivedTitle).toBe("Plan garden 134.");

        const repeated = await listProjectedSessions({ projection, opts });
        expect(repeated.sessions).toEqual(result.sessions);
        const disabled = await listProjectedSessions({
          projection,
          opts: { ...opts, includeDerivedTitles: false, includeLastMessage: false },
        });
        expect(disabled.sessions.map((row) => row.key)).toEqual(
          result.sessions.map((row) => row.key),
        );
        expect(disabled.sessions.every((row) => row.derivedTitle === undefined)).toBe(true);
        expect(disabled.sessions.every((row) => row.lastMessagePreview === undefined)).toBe(true);
      } finally {
        projection.dispose();
      }
    });
  },
);
