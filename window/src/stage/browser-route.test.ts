import { describe, expect, it } from "vitest";
import { HOST_BROWSER_ROUTE, addressBarUrl, activeRoute, isBlankTab, routeOf } from "./browser-route";
import type { BrowserPresentation } from "../thread/browser-presentation";

describe("addressBarUrl", () => {
  it("navigates to https:// for a plain domain", () => {
    expect(addressBarUrl("example.com")).toBe("https://example.com");
    expect(addressBarUrl("example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });
  it("searches for words that aren't an address", () => {
    expect(addressBarUrl("weather lisbon")).toBe("https://www.google.com/search?q=weather%20lisbon");
  });
  it("passes an http(s) address through unchanged", () => {
    expect(addressBarUrl("https://example.com")).toBe("https://example.com");
    expect(addressBarUrl("http://example.com/a?b=1")).toBe("http://example.com/a?b=1");
  });
  it("refuses javascript: and file: instead of navigating", () => {
    expect(addressBarUrl("javascript:alert(1)")).toBeNull();
    expect(addressBarUrl("file:///etc/passwd")).toBeNull();
  });
  it("adds https:// for host:port and bare localhost", () => {
    expect(addressBarUrl("example.com:8080")).toBe("https://example.com:8080");
    expect(addressBarUrl("localhost:3000")).toBe("https://localhost:3000");
    expect(addressBarUrl("localhost")).toBe("https://localhost");
  });
});

describe("activeRoute", () => {
  it("falls back to Branch's own host browser when nothing is recorded", () => {
    expect(routeOf([])).toBeNull();
    expect(activeRoute([])).toEqual(HOST_BROWSER_ROUTE);
  });
  it("keeps the newest recorded route", () => {
    const entries: BrowserPresentation[] = [
      { tab: { target: "node", node: "node-one", profile: "work", targetId: "tab-one" }, revision: "1" },
    ];
    expect(activeRoute(entries)).toEqual({ target: "node", node: "node-one", profile: "work" });
  });
});

describe("isBlankTab", () => {
  it("treats about:blank and an empty address as a new tab", () => {
    expect(isBlankTab("")).toBe(true);
    expect(isBlankTab("about:blank")).toBe(true);
    expect(isBlankTab("https://example.com")).toBe(false);
  });
});
