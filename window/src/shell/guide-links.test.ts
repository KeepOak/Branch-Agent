import { describe, expect, it, vi } from "vitest";
import { docsUrl, guideLinkItems, helpUrl } from "./guide-links";

describe("guide links", () => {
  it("offers only Docs and Ask for help, announces browser navigation and opens the real Help page", () => {
    const open = vi.fn();
    const items = guideLinkItems(open);
    expect(items.map(item => item.label)).toEqual(["Docs (opens in browser)", "Ask for help"]);
    expect(items[1].hint).toBe("opens in browser");
    expect(docsUrl).toBe("https://keepoak.com/help");
    expect(helpUrl).toBe("https://keepoak.com/help");
    items[0].run();
    items[1].run();
    expect(open.mock.calls).toEqual([[docsUrl], [helpUrl]]);
  });
});
