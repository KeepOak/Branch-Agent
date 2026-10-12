import { afterEach, describe, expect, it, vi } from "vitest";
import { LockdownError } from "../../../../src/config/lockdown.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../../../src/config/runtime-snapshot.js";
import { withRemoteHttpResponse } from "./remote-http.js";

describe("remote memory calls under Lockdown", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  // Every remote embedding provider (OpenAI-compatible, OpenAI and Google batches, Voyage, Copilot) posts here.
  it("refuses before any request leaves this computer", async () => {
    const fetchWithSsrFGuardImpl = vi.fn();
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
    await expect(
      withRemoteHttpResponse({
        url: "https://embeddings.example.test/v1/embeddings",
        fetchWithSsrFGuardImpl,
        shouldUseEnvHttpProxyForUrlImpl: () => false,
        onResponse: async () => "sent",
      }),
    ).rejects.toBeInstanceOf(LockdownError);
    expect(fetchWithSsrFGuardImpl).not.toHaveBeenCalled();
  });
});
