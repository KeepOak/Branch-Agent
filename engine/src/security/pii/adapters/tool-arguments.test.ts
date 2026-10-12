// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/adapters/messages.spec.ts (atlas SAFETY-0062)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrapToolWithBeforeToolCallHook } from "../../../agents/agent-tools.before-tool-call.js";
import type { AnyAgentTool } from "../../../agents/agent-tools.types.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../../config/runtime-snapshot.js";
import { SecuritySchema } from "../../../config/zod-schema.root-support.js";
import type { FiltersConfig } from "../filters.js";
import {
  applyToolArgumentPiiPolicy,
  extractToolArgumentContent,
  UNINSPECTABLE_TOOL_ARGUMENTS_REASON,
} from "./tool-arguments.js";

const emitTrustedSecurityEvent = vi.hoisted(() => vi.fn());

vi.mock("../../../infra/diagnostic-events.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infra/diagnostic-events.js")>()),
  emitTrustedSecurityEvent,
}));

function contentFilterEvents(): unknown[] {
  return emitTrustedSecurityEvent.mock.calls
    .map(([event]) => event as { action?: string })
    .filter((event) => event.action === "content_filter.finding");
}

const ORG_PATTERN = { id: "org-token", label: "organization token", regex: "ORG-[A-Z]+" };

function filtersWith(
  pii: NonNullable<FiltersConfig["toolArguments"]>["pii"],
  tokenSecret?: string,
) {
  return {
    toolArguments: { pii },
    ...(tokenSecret ? { tokenSecret } : {}),
  } satisfies FiltersConfig;
}

function deepArguments(depth: number): unknown {
  let value: unknown = "ORG-HIDDEN";
  for (let index = 0; index < depth; index++) {
    value = { next: value };
  }
  return value;
}

describe("extractToolArgumentContent", () => {
  it("extracts the tool name as inspect-only and every argument text leaf as replaceable", () => {
    const extraction = extractToolArgumentContent("send_mail", {
      to: "alice@example.com",
      count: 2,
      cc: ["bob@example.org"],
      "a/b": { body: "hello" },
    });

    expect(extraction.complete).toBe(true);
    expect(extraction.fragments).toEqual([
      expect.objectContaining({
        id: "tool-call.name",
        path: "/name",
        text: "send_mail",
        field: "name",
        treatment: "inspect_only",
      }),
      expect.objectContaining({
        path: "/arguments/to",
        field: "arguments",
        treatment: "replaceable",
      }),
      expect.objectContaining({ path: "/arguments/cc/0", text: "bob@example.org" }),
      expect.objectContaining({ path: "/arguments/a~1b/body", text: "hello" }),
    ]);
  });

  it("fails closed instead of silently truncating an oversized nested part", () => {
    expect(extractToolArgumentContent("tool", deepArguments(40)).complete).toBe(false);
    expect(
      applyToolArgumentPiiPolicy({
        filters: filtersWith({ starterPatterns: [], customPatterns: [ORG_PATTERN] }),
        toolName: "tool",
        params: deepArguments(40),
      }),
    ).toEqual({ kind: "block", reason: UNINSPECTABLE_TOOL_ARGUMENTS_REASON });
  });
});

describe("applyToolArgumentPiiPolicy", () => {
  beforeEach(() => {
    emitTrustedSecurityEvent.mockClear();
  });

  it("test_disabled_config_still_defaults_off_without_secret", () => {
    const params = { to: "alice@example.com" };
    expect(applyToolArgumentPiiPolicy({ filters: undefined, toolName: "send", params })).toEqual({
      kind: "allow",
      params,
    });
    expect(applyToolArgumentPiiPolicy({ filters: {}, toolName: "send", params }).kind).toBe(
      "allow",
    );
  });

  it("blocks a matching argument by default without echoing it", () => {
    const decision = applyToolArgumentPiiPolicy({
      filters: filtersWith({}),
      toolName: "send",
      params: { body: "write to alice@example.com" },
    });

    expect(decision.kind).toBe("block");
    expect(JSON.stringify(decision)).toContain("email address");
    expect(JSON.stringify(decision)).not.toContain("alice@example.com");
  });

  it("redacts matched argument leaves and keeps the rest of the call intact", () => {
    const decision = applyToolArgumentPiiPolicy({
      filters: filtersWith({ action: "redact" }),
      toolName: "send",
      params: {
        body: "mail alice@example.com or call +86 138 0013 8000",
        retries: 3,
        tags: ["ok"],
      },
    });

    expect(decision).toEqual({
      kind: "allow",
      params: { body: "mail [EMAIL_1] or call [PHONE_1]", retries: 3, tags: ["ok"] },
    });
    expect(contentFilterEvents()).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({ action: "redact", ruleId: "email", occurrences: 1 }),
      }),
    ]);
    expect(JSON.stringify(contentFilterEvents())).not.toContain("alice@example.com");
  });

  it("pseudonymises with keyed tokens when a token secret is configured", () => {
    const filters = filtersWith({ action: "redact" }, "unit-test-deployment-secret-0123456789");
    const first = applyToolArgumentPiiPolicy({
      filters,
      toolName: "send",
      params: { to: "alice@example.com" },
    });
    const second = applyToolArgumentPiiPolicy({
      filters,
      toolName: "send",
      params: { cc: "alice@example.com" },
    });

    expect(first).toMatchObject({
      kind: "allow",
      params: { to: expect.stringMatching(/^\[EMAIL_[a-z]{27}\]$/) },
    });
    expect((first as { params: { to: string } }).params.to).toBe(
      (second as { params: { cc: string } }).params.cc,
    );
  });

  it("fails closed when an inspect-only tool name matches a redact rule", () => {
    expect(
      applyToolArgumentPiiPolicy({
        filters: filtersWith({
          action: "redact",
          starterPatterns: [],
          customPatterns: [ORG_PATTERN],
        }),
        toolName: "ORG-TOOL",
        params: {},
      }).kind,
    ).toBe("block");
  });

  it("records audit-only findings without changing the call", () => {
    const params = { body: "ORG-SECRET" };
    expect(
      applyToolArgumentPiiPolicy({
        filters: filtersWith({
          action: "audit",
          starterPatterns: [],
          customPatterns: [ORG_PATTERN],
        }),
        toolName: "send",
        params,
      }),
    ).toEqual({ kind: "allow", params });
    expect(contentFilterEvents()).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          action: "audit",
          ruleId: "org-token",
          occurrences: 1,
        }),
      }),
    ]);
  });

  it("does not fail closed on incomplete audit-only traversal", () => {
    expect(
      applyToolArgumentPiiPolicy({
        filters: filtersWith({
          action: "audit",
          starterPatterns: [],
          customPatterns: [ORG_PATTERN],
        }),
        toolName: "tool",
        params: deepArguments(40),
      }).kind,
    ).toBe("allow");
  });
});

describe("security.contentFilters config", () => {
  it("is off by default and accepts a tool-argument rule", () => {
    expect(SecuritySchema.parse({})).toEqual({});
    expect(
      SecuritySchema.safeParse({
        contentFilters: {
          toolArguments: { pii: { action: "redact", starterPatterns: ["email"] } },
          tokenSecret: "unit-test-deployment-secret-0123456789",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unsafe custom regexes and unknown keys", () => {
    const parse = (pii: unknown) =>
      SecuritySchema.safeParse({ contentFilters: { toolArguments: { pii } } }).success;
    expect(parse({ customPatterns: [{ id: "x", label: "x", regex: "(a|aa)+$" }] })).toBe(false);
    expect(parse({ action: "pseudonymise" })).toBe(false);
    expect(parse({ fields: ["output"] })).toBe(false);
  });
});

describe("before_tool_call wiring", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  function wrapped() {
    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook(
      { name: "send_mail", execute } as unknown as AnyAgentTool,
      { runId: "pii-run", agentId: "main", sessionKey: "agent:main:main" },
    );
    const run = (params: unknown) =>
      tool.execute("call-1", params, undefined, {} as Parameters<typeof tool.execute>[3]);
    return { execute, run };
  }

  it("runs the tool unchanged when no filter is configured", async () => {
    const { execute, run } = wrapped();
    await run({ to: "alice@example.com" });
    expect(execute).toHaveBeenCalledWith(
      "call-1",
      { to: "alice@example.com" },
      undefined,
      expect.anything(),
    );
  });

  it("blocks a tool call carrying personal data without running it", async () => {
    const { execute, run } = wrapped();
    setRuntimeConfigSnapshot({ security: { contentFilters: filtersWith({}) } });
    const result = await run({ to: "alice@example.com" });
    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ details: { status: "blocked", deniedReason: "pii-filter" } });
  });

  it("passes redacted arguments to the tool", async () => {
    const { execute, run } = wrapped();
    setRuntimeConfigSnapshot({ security: { contentFilters: filtersWith({ action: "redact" }) } });
    await run({ to: "alice@example.com" });
    expect(execute).toHaveBeenCalledWith(
      "call-1",
      { to: "[EMAIL_1]" },
      undefined,
      expect.anything(),
    );
  });
});
