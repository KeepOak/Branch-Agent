// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/audit.spec.ts (atlas SAFETY-0062)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateAuditFindings, aggregateAuditFindingsSync } from "./audit.js";
import type { FiltersConfig } from "./filters.js";
import { inspectContent } from "./runtime.js";
import type { TextContentFragment } from "./types.js";

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emitTrustedSecurityEvent: vi.fn(),
}));

vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => mocks.logger,
}));

vi.mock("../../infra/diagnostic-events.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/diagnostic-events.js")>()),
  emitTrustedSecurityEvent: mocks.emitTrustedSecurityEvent,
}));

const AUDIT_PATTERN = {
  id: "org-token",
  label: "organization token",
  regex: "ORG-[A-Z0-9]+",
};

const auditFilters: FiltersConfig = {
  toolArguments: {
    pii: {
      action: "audit",
      starterPatterns: [],
      customPatterns: [AUDIT_PATTERN],
    },
  },
};

function fragment(text: string, field: "name" | "arguments" = "arguments"): TextContentFragment {
  return {
    id: "tool-call.arguments",
    text,
    path: "/arguments/text",
    source: "tool_argument",
    field,
    format: "plain",
    treatment: "replaceable",
    provenance: "model",
  };
}

function matchingFragments(count: number): TextContentFragment[] {
  return Array.from({ length: count }, (_, index) => fragment(`ORG-${index}`));
}

function auditCalls(): unknown[][] {
  return mocks.logger.info.mock.calls.filter(([message]) =>
    String(message).startsWith("[content-filter] Audit-only finding"),
  );
}

describe("audit finding aggregation", () => {
  beforeEach(() => {
    mocks.logger.info.mockClear();
    mocks.emitTrustedSecurityEvent.mockClear();
  });

  it("reports one audit finding per rule for a snapshot that matches thousands of times", async () => {
    await expect(
      aggregateAuditFindings(async () =>
        inspectContent(matchingFragments(4_096), { filters: auditFilters }),
      ),
    ).resolves.toBeNull();

    expect(auditCalls()).toHaveLength(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"occurrences":4096'),
      expect.objectContaining({ action: "audit", ruleId: "org-token", occurrences: 4_096 }),
    );
  });

  it("bounds a repeated retrieval to one aggregated finding per request", async () => {
    const fragments = matchingFragments(512);

    await aggregateAuditFindings(async () => inspectContent(fragments, { filters: auditFilters }));
    await aggregateAuditFindings(async () => inspectContent(fragments, { filters: auditFilters }));

    const calls = auditCalls();
    expect(calls).toHaveLength(2);
    for (const [, metadata] of calls) {
      expect(metadata).toMatchObject({ ruleId: "org-token", occurrences: 512 });
    }
  });

  it("counts each configured audit rule separately", async () => {
    await aggregateAuditFindings(async () =>
      inspectContent([fragment("ORG-NAME", "name"), ...matchingFragments(8)], {
        filters: auditFilters,
      }),
    );

    const calls = auditCalls();
    expect(calls).toHaveLength(2);
    expect(calls.map(([, metadata]) => metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "arguments", occurrences: 8 }),
        expect.objectContaining({ field: "name", occurrences: 1 }),
      ]),
    );
  });

  it("reports aggregated findings when a later message is blocked", async () => {
    await expect(
      aggregateAuditFindings(async () => {
        inspectContent(matchingFragments(64), { filters: auditFilters });
        throw new Error("blocked by a later policy");
      }),
    ).rejects.toThrow("blocked by a later policy");

    expect(auditCalls()).toHaveLength(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"occurrences":64'),
      expect.objectContaining({ ruleId: "org-token", occurrences: 64 }),
    );
  });

  it("aggregates the fragments of one model-bound inspection", () => {
    expect(() =>
      aggregateAuditFindingsSync(() =>
        inspectContent(matchingFragments(512), { filters: auditFilters }),
      ),
    ).not.toThrow();

    expect(auditCalls().map(([, metadata]) => metadata)).toEqual([
      expect.objectContaining({ source: "tool_argument", field: "arguments", occurrences: 512 }),
    ]);
  });

  it("keeps rules whose ids and labels differ only by spacing separate", async () => {
    const filters: FiltersConfig = {
      toolArguments: {
        pii: {
          action: "audit",
          starterPatterns: [],
          customPatterns: [
            { id: "a", label: "b c", regex: "ALPHA" },
            { id: "a b", label: "c", regex: "BETA" },
          ],
        },
      },
    };

    await aggregateAuditFindings(async () =>
      inspectContent([fragment("ALPHA"), fragment("BETA")], { filters }),
    );

    expect(auditCalls().map(([, metadata]) => metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "a", label: "b c", occurrences: 1 }),
        expect.objectContaining({ ruleId: "a b", label: "c", occurrences: 1 }),
      ]),
    );
  });

  it("reports findings immediately outside an aggregation scope", () => {
    expect(
      inspectContent([fragment("ORG-SECRET"), fragment("ORG-OTHER")], { filters: auditFilters }),
    ).toBeNull();

    const calls = auditCalls();
    expect(calls).toHaveLength(2);
    for (const [, metadata] of calls) {
      expect(metadata).toMatchObject({ occurrences: 1 });
    }
  });

  it("writes each aggregated finding to the trusted security event stream without raw text", async () => {
    await aggregateAuditFindings(async () =>
      inspectContent(matchingFragments(3), { filters: auditFilters }),
    );

    expect(mocks.emitTrustedSecurityEvent).toHaveBeenCalledTimes(1);
    expect(mocks.emitTrustedSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "audit",
        action: "content_filter.finding",
        attributes: expect.objectContaining({ ruleId: "org-token", occurrences: 3 }),
      }),
    );
    expect(JSON.stringify(mocks.emitTrustedSecurityEvent.mock.calls)).not.toContain("ORG-0");
  });
});
