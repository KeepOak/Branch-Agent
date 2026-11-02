import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { outsideAgentFromClient } from "./outside-presence.js";

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

it("defaults the computer to the display placeholder, never the real hostname", () => {
  const cwd = "/w/Branch-Agent";
  const agent = outsideAgentFromClient({ name: "claude-code", version: "2.1.0" }, undefined, cwd);
  expect(agent).toMatchObject({ name: "Claude Code", where: PLACEHOLDER, project: "Branch-Agent" });
  expect(JSON.stringify(agent)).not.toContain(REAL_HOST);
  // The instance tag is computed from the placeholder, not from the real hostname.
  const withPlaceholder = outsideAgentFromClient({ name: "claude-code" }, PLACEHOLDER, cwd);
  const withRealHost = outsideAgentFromClient({ name: "claude-code" }, REAL_HOST, cwd);
  expect(agent?.id).toBe(withPlaceholder?.id);
  expect(agent?.id).not.toBe(withRealHost?.id);
});
