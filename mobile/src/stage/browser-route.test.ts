import { browserCall, DEFAULT_BROWSER_ROUTE, profileLine, readTabs, routeKey } from "./browser-route";
import type { EngineLink } from "../pairing/pairingSession";

describe("browser route helpers", () => {
  it("reads page tabs and ignores non-page targets", () => {
    expect(
      readTabs({
        tabs: [
          { targetId: "one", title: "Report", url: "https://example.test", type: "page" },
          { targetId: "worker", title: "", url: "", type: "worker" },
          { title: "no id" },
        ],
      }),
    ).toEqual([{ targetId: "one", title: "Report", url: "https://example.test" }]);
  });

  it("names Branch's managed profile in plain words", () => {
    expect(profileLine(DEFAULT_BROWSER_ROUTE)).toBe("Branch’s own browser · its own profile");
    expect(profileLine({ target: "host", profile: "work" })).toBe("The browser’s work profile");
    expect(profileLine(null)).toBe("");
  });

  it("sends browser.request on the host route with tabScope when a session is given", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const link: EngineLink = {
      hello: null,
      onEvent: () => () => undefined,
      onConnected: () => () => undefined,
      request: async (method, params) => {
        calls.push({ method, params });
        return { ok: true } as never;
      },
    };
    await browserCall(link, DEFAULT_BROWSER_ROUTE, "POST", "/navigate", {
      targetId: "tab-one",
      body: { url: "https://example.test" },
      sessionKey: "agent:oak:main",
    });
    expect(calls).toEqual([
      {
        method: "browser.request",
        params: {
          target: "host",
          method: "POST",
          path: "/navigate",
          query: { profile: "branch" },
          body: { url: "https://example.test", targetId: "tab-one" },
          tabScope: { sessionKey: "agent:oak:main" },
        },
      },
    ]);
    expect(routeKey(DEFAULT_BROWSER_ROUTE)).toBe(JSON.stringify(["host", undefined, "branch"]));
  });
});
