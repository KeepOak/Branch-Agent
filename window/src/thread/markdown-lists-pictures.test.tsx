// @vitest-environment jsdom
// Devices run 2026-10-06 (B13): every numbered item in a reply read "1.", and a screenshot the Trunk returned showed
// as a raw markdown link to a local path instead of a picture.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ThreadContext } from "./context";
import { Markdown, parseMarkdown } from "./markdown";
import { loadMediaPicture } from "../connect/session";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const KEY = "agent:juniper:main";
const BASE = "http://127.0.0.1:19700/__branch__/assistant-media";
type Call = { url: string; init?: RequestInit };
/** The gateway's assistant-media route as the window reaches it: meta=1 with a Bearer header answers a ticket. */
function gateway(answer: (source: string) => Record<string, unknown> | number = () => ({ available: true, mediaTicket: "v1.t.s" })) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const result = answer(new URL(url).searchParams.get("source") ?? "");
    return typeof result === "number" ? new Response("", { status: result }) : new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  const engine: WindowEngine = {
    sessionKey: KEY, agentId: "juniper", scopes: [], onEvent: () => () => {}, request: (async () => ({})) as WindowEngine["request"],
    mediaPicture: (source) => loadMediaPicture("ws://127.0.0.1:19700", source, KEY, "juniper", "secret-gateway-token", fetcher),
  };
  return { engine, calls };
}
const engine = gateway().engine;

async function mount(text: string, e: WindowEngine | undefined = engine) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<ThreadContext.Provider value={{ engine: e, name: "Juniper", toast: () => undefined, running: false }}><Markdown text={text} /></ThreadContext.Provider>));
  await act(async () => {});
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
  it("shows a screenshot the Trunk saved through a media ticket: the gateway credential is never in a URL", async () => {
    const { engine: e, calls } = gateway();
    const host = await mount("Here it is:\n\n[screenshot](/home/ubuntu/ws/shot.png)", e);
    expect(calls).toHaveLength(1);
    const meta = new URL(calls[0]!.url);
    expect(meta.origin + meta.pathname).toBe(BASE);
    expect(Object.fromEntries(meta.searchParams)).toEqual({ meta: "1", source: "/home/ubuntu/ws/shot.png", sessionKey: KEY, agentId: "juniper" });
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: "Bearer secret-gateway-token" });
    const img = host.querySelector(".picture img") as HTMLImageElement;
    const url = new URL(img.getAttribute("src")!);
    expect(Object.fromEntries(url.searchParams)).toEqual({ source: "/home/ubuntu/ws/shot.png", sessionKey: KEY, agentId: "juniper", mediaTicket: "v1.t.s" });
    expect(img.getAttribute("src")).not.toContain("secret-gateway-token");
    expect(img.getAttribute("src")).not.toMatch(/[?&]token=/);
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(host.textContent).not.toContain("/home/ubuntu");
  });

  it("passes a file: address to the engine as written", async () => {
    const { engine: e, calls } = gateway();
    await mount("![s](file:///C:/Users/First%20Last/s.png)", e);
    expect(new URL(calls[0]!.url).searchParams.get("source")).toBe("file:///C:/Users/First%20Last/s.png");
  });

  it("uses https for a wss gateway", async () => {
    const calls: string[] = [];
    await loadMediaPicture("wss://hub.example:443/", "/a.png", KEY, undefined, null, (async (url: string) => { calls.push(url); return new Response("{}"); }) as typeof fetch);
    expect(calls[0]).toBe(`https://hub.example/__branch__/assistant-media?meta=1&source=%2Fa.png&sessionKey=${encodeURIComponent(KEY)}`);
  });

  it("says Outside allowed folders when the engine says so, with no Try again", async () => {
    const { engine: e } = gateway(() => ({ available: false, code: "outside-allowed-folders" }));
    const host = await mount("![Screen](/etc/shot.png)", e);
    expect(host.querySelector('[data-testid="picture-unavailable"]')?.textContent).toBe("IMGScreenOutside allowed folders");
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

  it("asks for a new ticket without a word when a picture's ticket ran out before it loaded", async () => {
    let n = 0;
    const { engine: e, calls } = gateway(() => ({ available: true, mediaTicket: `v1.t${++n}.s` }));
    const host = await mount("Saved ![s](/tmp/shot.png) here.", e);
    const first = host.querySelector("img.md-inline-picture")!;
    expect(first.getAttribute("src")).toContain("mediaTicket=v1.t1.s");
    // Scrolled to after five minutes: the engine refuses the old ticket and the image fails.
    await act(async () => first.dispatchEvent(new Event("error")));
    await act(async () => {});
    expect(calls).toHaveLength(2);
    expect(host.querySelector('[data-testid="picture-unavailable"]')).toBeNull();
    expect(host.querySelector("img.md-inline-picture")!.getAttribute("src")).toContain("mediaTicket=v1.t2.s");
  });

  it("earns the silent retry back once a picture loads, so a later expired ticket is replaced without a word again", async () => {
    let n = 0;
    const { engine: e, calls } = gateway(() => ({ available: true, mediaTicket: `v1.t${++n}.s` }));
    const host = await mount("![Screen](/tmp/shot.png)", e);
    await act(async () => host.querySelector(".picture img")!.dispatchEvent(new Event("error")));
    await act(async () => {});
    await act(async () => host.querySelector(".picture img")!.dispatchEvent(new Event("load")));
    await act(async () => host.querySelector(".picture img")!.dispatchEvent(new Event("error")));
    await act(async () => {});
    expect(calls).toHaveLength(3);
    expect(host.querySelector('[data-testid="picture-unavailable"]')).toBeNull();
  });

  it("says Picture unavailable when it still doesn't load after one new ticket, and Try again asks again", async () => {
    const { engine: e, calls } = gateway();
    const host = await mount("![Screen](/tmp/shot.png)", e);
    await act(async () => host.querySelector(".picture img")!.dispatchEvent(new Event("error")));
    await act(async () => {});
    expect(calls).toHaveLength(2);
    await act(async () => host.querySelector(".picture img")!.dispatchEvent(new Event("error")));
    const gone = host.querySelector('[data-testid="picture-unavailable"]')!;
    expect(gone.textContent).toBe("IMGScreenPicture unavailableTry again");
    expect(calls).toHaveLength(2);
    await act(async () => (gone.querySelector("button") as HTMLButtonElement).click());
    await act(async () => {});
    expect(calls).toHaveLength(3);
    expect(host.querySelector(".picture img")).not.toBeNull();
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
