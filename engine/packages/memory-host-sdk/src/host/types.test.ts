import { describe, expect, it } from "vitest";
import {
  resolveMemoryIndexIdentityDiagnostic,
  resolveMemorySearchStaleness,
  type MemoryProviderStatus,
} from "./types.js";

describe("memory search staleness", () => {
  it("keeps routine pending index work silent", () => {
    const status: MemoryProviderStatus = {
      backend: "builtin",
      provider: "none",
      dirty: true,
    };
    expect(resolveMemorySearchStaleness(status)).toBeNull();
  });

  it("reports the latest automatic sync failure", () => {
    expect(
      resolveMemorySearchStaleness({ lastSyncError: "embedding request timed out" }, "main"),
    ).toEqual({
      stale: true,
      warning:
        "Memory index is stale: embedding request timed out. Search results may be incomplete.",
      action:
        "Run: branch memory status --index --agent main. Rebuilding may call the configured embedding provider and can incur provider cost.",
    });
  });

  it("gives an incompatible index identity precedence over a sync failure", () => {
    expect(
      resolveMemorySearchStaleness({
        lastSyncError: "embedding request timed out",
        custom: {
          indexIdentity: {
            status: "mismatched",
            reason: "embedding model changed",
            code: "model",
            owner: "configuration",
          },
        },
      }),
    ).toMatchObject({ warning: expect.stringContaining("embedding model changed") });
  });

  it.each(["provenance_version", "chunking_version"])(
    "reports the failed repair prerequisite while %s is still incompatible",
    (code) => {
      expect(
        resolveMemorySearchStaleness(
          {
            lastSyncError: "HTTP 400: embedding provider unavailable",
            custom: {
              indexIdentity: {
                status: "mismatched",
                reason: "runtime format changed",
                code,
                owner: "branch",
              },
            },
          },
          "main",
        ),
      ).toEqual({
        stale: true,
        warning:
          "Memory index repair failed: HTTP 400: embedding provider unavailable. The existing index was left unchanged.",
        action:
          "Run: branch memory status --deep --agent main. Resolve the reported sync failure before retrying the search.",
      });
    },
  );

  it.each(["provenance_version", "chunking_version"])(
    "keeps newer-index recovery visible after a prior sync failure (%s)",
    (code) => {
      const status: MemoryProviderStatus = {
        backend: "builtin",
        provider: "openai",
        lastSyncError: "HTTP 400: embedding provider unavailable",
        custom: {
          indexIdentity: {
            status: "mismatched",
            reason:
              "the index was written by a newer Branch Agent version; upgrade Branch Agent or reindex explicitly",
            code,
            owner: "branch",
            versionOrder: "newer",
          },
        },
      };
      const result = resolveMemorySearchStaleness(status, "main");
      expect(result?.warning).toContain("newer Branch Agent version");
      expect(result?.warning).toContain("Previous memory sync failed: HTTP 400");
      expect(result?.action).toContain("Upgrade Branch Agent or reindex explicitly");
      expect(result?.action).toContain("provider cost");
      expect(status.lastSyncError).toBe("HTTP 400: embedding provider unavailable");
    },
  );

  it("attributes a Branch-owned format mismatch and names the repair cost", () => {
    const status: MemoryProviderStatus = {
      backend: "builtin",
      provider: "openai",
      custom: {
        indexIdentity: {
          status: "mismatched",
          reason: "index provenance classifier changed",
          code: "provenance_version",
          owner: "branch",
        },
      },
    };
    expect(resolveMemoryIndexIdentityDiagnostic(status)).toEqual({
      status: "mismatched",
      reason: "index provenance classifier changed",
      code: "provenance_version",
      owner: "branch",
    });
    expect(resolveMemorySearchStaleness(status, "main")).toEqual({
      stale: true,
      warning:
        "Memory index is stale: index provenance classifier changed (owner: branch, code: provenance_version). Search results may be incomplete.",
      action:
        "Run: branch memory status --index --agent main. Rebuilding may call the configured embedding provider and can incur provider cost.",
    });
  });

  it("preserves the keyword-only marker only when a pending upgrade carries it", () => {
    const base = {
      status: "mismatched",
      reason: "index chunking implementation changed",
      code: "chunking_version",
      owner: "branch",
    } as const;
    expect(
      resolveMemoryIndexIdentityDiagnostic({
        custom: { indexIdentity: { ...base, chunkingVersionOnly: true } },
      }),
    ).toEqual({ ...base, chunkingVersionOnly: true });
    expect(
      resolveMemoryIndexIdentityDiagnostic({
        custom: { indexIdentity: { ...base, versionOrder: "newer", chunkingVersionOnly: true } },
      }),
    ).toEqual(base);
    expect(
      resolveMemoryIndexIdentityDiagnostic({
        custom: { indexIdentity: { ...base } },
      }),
    ).toEqual({ ...base });
  });

  it("does not claim provider cost for a keyword-only index", () => {
    expect(
      resolveMemorySearchStaleness(
        {
          provider: "none",
          requestedProvider: "none",
          custom: {
            indexIdentity: {
              status: "mismatched",
              reason: "index sources changed",
              code: "sources",
              owner: "configuration",
            },
          },
        },
        "main",
      ),
    ).toEqual({
      stale: true,
      warning:
        "Memory index is stale: index sources changed (owner: configuration, code: sources). Search results may be incomplete.",
      action:
        "Run: branch memory status --index --agent main. Rebuilding uses keyword indexing only and does not call an embedding provider.",
    });
  });

  it("uses configured provider intent after runtime degradation", () => {
    expect(
      resolveMemorySearchStaleness(
        {
          provider: "none",
          requestedProvider: "openai",
          custom: {
            indexIdentity: {
              status: "mismatched",
              reason: "index provenance classifier changed",
              code: "provenance_version",
              owner: "branch",
            },
          },
        },
        "main",
      ),
    ).toMatchObject({
      action:
        "Run: branch memory status --index --agent main. Rebuilding may call the configured embedding provider and can incur provider cost.",
    });
  });

  it.each([
    {
      status: "mismatched",
      reason: "missing code and owner",
    },
    {
      status: "mismatched",
      reason: "invalid owner for code",
      code: "provider",
      owner: "branch",
    },
    {
      status: "missing",
      reason: "invalid missing state",
      code: "metadata_missing",
      owner: "configuration",
    },
  ])("rejects malformed identity diagnostic %#", (indexIdentity) => {
    expect(resolveMemoryIndexIdentityDiagnostic({ custom: { indexIdentity } })).toBeUndefined();
  });
});
