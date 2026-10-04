// Ported metadata option/validation cases from pinned Goose new_session.rs and server.rs meta_string.
import { expect, it, vi } from "vitest";
import type { GatewayClient } from "../gateway/client.js";
import {
  persistAcpSessionCreationMeta,
  readAcpSessionCreationMeta,
} from "./session-creation-meta.js";

// The original five new_session.rs creation cases, retaining their exact defaults and precedence.
it("hidden_meta_yields_hidden_session", () => {
  expect(readAcpSessionCreationMeta({ hidden: true }).sessionType).toBe("hidden");
});
it("hidden_overrides_client", () => {
  expect(readAcpSessionCreationMeta({ hidden: true, client: "desktop" }).sessionType).toBe(
    "hidden",
  );
  expect(readAcpSessionCreationMeta({ hidden: true, client: 7 }).sessionType).toBe("hidden");
});
it("absent_hidden_preserves_acp", () => {
  for (const meta of [undefined, null, {}, { hidden: false }, { hidden: null, client: null }]) {
    expect(readAcpSessionCreationMeta(meta).sessionType).toBe("acp");
  }
});
it("non_bool_hidden_is_rejected", () => {
  expect(() => readAcpSessionCreationMeta({ hidden: "yes", client: "desktop" })).toThrow(
    "hidden must be a boolean",
  );
});
it("client_meta_yields_user_session", () => {
  for (const client of ["desktop", "", "  "]) {
    expect(readAcpSessionCreationMeta({ client }).sessionType).toBe("user");
  }
});
it("rejects malformed client values when Hidden does not override them", () => {
  for (const client of [7, true, {}, []]) {
    expect(() => readAcpSessionCreationMeta({ hidden: false, client })).toThrow(
      "client must be a string",
    );
  }
});

it("preserves project identity and trims only the client title", () => {
  expect(
    readAcpSessionCreationMeta({ projectId: "project-exact", sessionTitle: "  Client title  " }),
  ).toEqual({ sessionType: "acp", projectId: "project-exact", sessionTitle: "Client title" });
});
it("ignores missing/null fields and whitespace-only titles", () => {
  for (const meta of [
    undefined,
    null,
    {},
    { projectId: null, sessionTitle: null },
    { sessionTitle: " \n " },
  ]) {
    expect(readAcpSessionCreationMeta(meta)).toEqual({ sessionType: "acp" });
  }
});
it("rejects non-string project/title fields instead of silently losing them", () => {
  for (const key of ["projectId", "sessionTitle"]) {
    for (const value of [true, 3, {}, []]) {
      expect(() => readAcpSessionCreationMeta({ [key]: value })).toThrow(`${key} must be a string`);
    }
  }
});
it("preserves a title longer than 500 characters without a Branch-only cap", () => {
  const sessionTitle = "Long title ".repeat(200);
  expect(readAcpSessionCreationMeta({ sessionTitle }).sessionTitle).toBe(sessionTitle.trim());
});
it("uses the authorized native creation endpoint and adopts its canonical key", async () => {
  const request = vi.fn().mockResolvedValue({
    ok: true,
    key: "agent:main:canonical",
    entry: { spawnedCwd: "/registered-project", sessionRoot: "/session-root" },
  });
  const key = await persistAcpSessionCreationMeta(
    { request: request as GatewayClient["request"] },
    "bridge",
    "/fixture",
    { projectId: "project", sessionTitle: "Title" },
  );
  expect(key).toEqual({ sessionKey: "agent:main:canonical", cwd: "/registered-project" });
  expect(request).toHaveBeenCalledExactlyOnceWith("sessions.create", {
    key: "bridge",
    sessionType: "acp",
    projectId: "project",
    displayName: "Title",
  });
});
it("creates the durable default Acp row even when metadata contains only routing fields", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, key: "selected" });
  expect(
    await persistAcpSessionCreationMeta(
      { request: request as GatewayClient["request"] },
      "selected",
      "/fixture",
      readAcpSessionCreationMeta({ sessionKey: "selected", reset: false }),
    ),
  ).toEqual({ sessionKey: "selected", cwd: "/fixture" });
  expect(request).toHaveBeenCalledExactlyOnceWith("sessions.create", {
    key: "selected",
    cwd: "/fixture",
    sessionType: "acp",
  });
});
it("uses native session root on adoption and preserves cwd when placement is absent", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, key: "adopted", entry: { sessionRoot: "/native-root" } })
    .mockResolvedValueOnce({ ok: true, key: "created" });
  const gateway = { request: request as GatewayClient["request"] };
  const meta = { sessionTitle: "Title" };
  await expect(
    persistAcpSessionCreationMeta(gateway, "selected", "/caller", meta),
  ).resolves.toEqual({ sessionKey: "adopted", cwd: "/native-root" });
  await expect(
    persistAcpSessionCreationMeta(gateway, "selected", "/caller", meta),
  ).resolves.toEqual({ sessionKey: "created", cwd: "/caller" });
});
it("does not report successful metadata application after endpoint rejection or malformed success", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("missing operator.write"))
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, key: "wrong" });
  const apply = () =>
    persistAcpSessionCreationMeta(
      { request: request as GatewayClient["request"] },
      "selected",
      "/fixture",
      { sessionTitle: "Title" },
    );
  await expect(apply()).rejects.toThrow("missing operator.write");
  await expect(apply()).rejects.toThrow("did not return a session key");
  await expect(apply()).rejects.toThrow("did not return a session key");
});
