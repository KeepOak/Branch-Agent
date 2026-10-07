import { expect, test, vi } from "vitest";
import {
  getActiveMemoryProviderCore,
  getMemorySearchManager,
  invokeDoctorMemory,
  resolveActiveMemoryBackendConfig,
  respondPayload,
} from "./doctor.test-support.js";

test("doctor.memory.status reports native provider health without probing legacy embeddings", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  const health = vi.fn().mockResolvedValue({ status: "degraded", message: "warming" });
  resolveActiveMemoryBackendConfig.mockReturnValue({
    backend: "provider-runtime",
    providerId: "records",
  });
  getActiveMemoryProviderCore.mockResolvedValue({
    providerId: "records",
    provider: { health, close },
  });
  const respond = vi.fn();

  await invokeDoctorMemory("doctor.memory.status", respond);

  expect(getMemorySearchManager).not.toHaveBeenCalled();
  expect(health).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(respondPayload(respond)).toMatchObject({
    agentId: "main",
    provider: "records",
    health: { status: "degraded", message: "warming" },
    embedding: { checked: false },
  });
});

test("doctor.memory.status reports provider-change rebuild progress only while sync runs", async () => {
  const progress = { completed: 3, total: 8 };
  const status = vi.fn(() => ({
    provider: "local",
    chunks: 99,
    custom: { indexIdentity: { status: "mismatched" }, providerChangeProgress: progress },
  }));
  getMemorySearchManager.mockResolvedValue({
    manager: { status, getCachedEmbeddingAvailability: () => ({ ok: false, checked: false }) },
    searchRuntimeRegistered: true,
  });
  const respond = vi.fn();
  await invokeDoctorMemory("doctor.memory.status", respond, { params: { agentId: "main" } });
  expect(respondPayload(respond).rebuild).toEqual({ state: "rebuilding", done: 3, total: 8 });
  status.mockReturnValue({
    provider: "local",
    chunks: 99,
    custom: { indexIdentity: { status: "mismatched" }, providerChangeProgress: undefined },
  });
  await invokeDoctorMemory("doctor.memory.status", respond, { params: { agentId: "main" } });
  expect(respondPayload(respond, 1).rebuild).toEqual({ state: "ready", done: 0, total: 0 });
});
