// Focused test: the connect handshake schema requires client.id, so no harness connect reaches the hostname fallback.
import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { presenceHostForClient } from "./connect-session.js";

const REAL_HOST = "real-host-should-not-show";
const PLACEHOLDER = "Tour Mac";
const savedDisplayHostname = process.env.BRANCH_DISPLAY_HOSTNAME;

beforeEach(() => {
  process.env.BRANCH_DISPLAY_HOSTNAME = PLACEHOLDER;
  vi.spyOn(os, "hostname").mockReturnValue(REAL_HOST);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedDisplayHostname === undefined) {
    delete process.env.BRANCH_DISPLAY_HOSTNAME;
  } else {
    process.env.BRANCH_DISPLAY_HOSTNAME = savedDisplayHostname;
  }
});

it("uses the display placeholder for a client with no display name and no id", () => {
  const host = presenceHostForClient({});
  expect(host).toBe(PLACEHOLDER);
  expect(host).not.toContain(REAL_HOST);
});

it("keeps the client's own display name, then its id, ahead of the machine name", () => {
  expect(presenceHostForClient({ displayName: "Ada's laptop", id: "cli" })).toBe("Ada's laptop");
  expect(presenceHostForClient({ id: "cli" })).toBe("cli");
});
