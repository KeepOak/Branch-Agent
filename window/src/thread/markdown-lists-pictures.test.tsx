// @vitest-environment jsdom
// Devices run 2026-10-06 (B13): every numbered item in a reply read "1.", and a screenshot the Trunk returned showed
// as a raw markdown link to a local path instead of a picture.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ThreadContext } from "./context";
import { Markdown, parseMarkdown } from "./markdown";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const PNG = "iVBORw0KGgo=";
function engine(files: Record<string, unknown>): WindowEngine & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked, sessionKey: "agent:juniper:main", scopes: [], onEvent: () => () => {},
    request: (async (method: string, params: { path: string }) => {
      asked.push([method, params]);
      const found = files[params.path];
      if (found instanceof Error) throw found;
      return { file: found };
    }) as WindowEngine["request"],
  };
}

async function mount(text: string, e?: WindowEngine) {
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

describe("pictures in replies", () => {
  it("shows a screenshot the Trunk saved as a picture, read through the conversation's files", async () => {
    const e = engine({ "/home/ubuntu/ws/shot.png": { path: "shot.png", name: "shot.png", missing: false, mimeType: "image/png", contentEncoding: "base64", content: PNG } });
    const host = await mount("Here it is:\n\n[screenshot](/home/ubuntu/ws/shot.png)", e);
    expect(e.asked).toEqual([["sessions.files.get", { sessionKey: "agent:juniper:main", path: "/home/ubuntu/ws/shot.png" }]]);
    const img = host.querySelector(".picture img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(`data:image/png;base64,${PNG}`);
    expect(img.alt).toBe("screenshot");
    expect(host.textContent).not.toContain("/home/ubuntu");
  });

  it("shows ![alt](https://…) as a picture as is", async () => {
    const host = await mount("![Chart](https://example.com/chart.png)");
    expect((host.querySelector(".picture img") as HTMLImageElement).getAttribute("src")).toBe("https://example.com/chart.png");
  });

  it("says when a picture is outside the folders the Trunk may read, and offers Try again when it's unavailable", async () => {
    const outside = Object.assign(new Error("session file not found"), { details: { reason: "outside_session_boundary" } });
    const e = engine({ "/tmp/shot.png": outside, "/home/x/gone.png": new Error("boom") });
    const host = await mount("![Screen](/tmp/shot.png)\n\n![Other](/home/x/gone.png)", e);
    const gone = [...host.querySelectorAll('[data-testid="picture-unavailable"]')].map((el) => el.textContent);
    expect(gone).toEqual(["IMGScreenOutside allowed folders", "IMGOtherPicture unavailableTry again"]);
  });

  it("names a local non-picture file without a broken link", async () => {
    const host = await mount("Saved to [report.md](/home/ubuntu/ws/report.md).");
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector(".md-path")?.getAttribute("title")).toBe("/home/ubuntu/ws/report.md");
  });
});
