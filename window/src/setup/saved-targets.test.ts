// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { readSavedTargets, readTargetName, saveTargetName } from "./pre-connect-state";

const savedTargetsKey = "branch.gatewayTargets.v1";
const remote = { url: "wss://remote.example.test", name: "Remote" };

afterEach(() => localStorage.clear());

it.each(["127.0.0.1", "localhost", "[::1]"])("does not remember handoff ports on %s", host => {
  const first = "ws://" + host + ":5001";
  const second = "ws://" + host + ":5002";
  saveTargetName(first, "Desk");
  saveTargetName(second, "Desk");
  expect(readSavedTargets()).toEqual([]);
  expect(localStorage.getItem(savedTargetsKey)).toBeNull();
  expect(readTargetName(second)).toBe("Desk");
});

it("filters legacy loopback rows and duplicate remote URLs on read", () => {
  const local = Array.from({ length: 8 }, (_, index) => ({
    url: "ws://127.0.0.1:" + (5001 + index), name: "Desk",
  }));
  localStorage.setItem(savedTargetsKey, JSON.stringify([
    ...local,
    { url: "ws://localhost:5001", name: "Desk" },
    { url: "ws://[::1]:5001", name: "Desk" },
    remote, remote,
  ]));
  expect(readSavedTargets()).toEqual([remote]);
});

it("replaces the saved name for a remote URL without adding another row", () => {
  saveTargetName(remote.url, remote.name);
  saveTargetName(remote.url, " Renamed ");
  expect(readSavedTargets()).toEqual([{ url: remote.url, name: "Renamed" }]);
});

it("keeps distinct remote URLs even when their names match", () => {
  saveTargetName(remote.url, remote.name);
  saveTargetName("wss://other.example.test", remote.name);
  expect(readSavedTargets()).toEqual([
    remote, { url: "wss://other.example.test", name: remote.name },
  ]);
});

it("ignores invalid stored rows and malformed storage", () => {
  localStorage.setItem(savedTargetsKey, JSON.stringify([
    null, {}, { url: remote.url, name: " " },
    { url: "https://remote.example.test", name: "Remote" }, remote,
  ]));
  expect(readSavedTargets()).toEqual([remote]);
  localStorage.setItem(savedTargetsKey, "not json");
  expect(readSavedTargets()).toEqual([]);
});
