// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThreadContext } from "../thread/context";
import { resetFreshMarks, useFreshClass } from "../thread/fresh";

const rootDir = join(process.cwd(), "src");
const threadCss = readFileSync(join(rootDir, "thread/thread.css"), "utf8");
const frameCss = readFileSync(join(rootDir, "shell/frame.css"), "utf8");
const contactsCss = readFileSync(join(rootDir, "shell/contacts-layout.css"), "utf8");
const tokensCss = readFileSync(join(rootDir, "theme/tokens.css"), "utf8");
const placeView = readFileSync(join(rootDir, "places-nav/PlaceView.tsx"), "utf8");
const mainTsx = readFileSync(join(rootDir, "main.tsx"), "utf8");

describe("motion pass (preview rise, sugIn, enter11, pinIn)", () => {
  it("keeps the preview enter tokens", () => {
    expect(tokensCss).toMatch(/--t-enter:\s*240ms/);
    expect(tokensCss).toMatch(/--ease-enter:\s*cubic-bezier\(0\.2,\s*0\.7,\s*0\.2,\s*1\)/);
  });

  it("rises new messages and fades suggestion chips behind still and reduced-motion guards", () => {
    expect(threadCss).toMatch(/@keyframes rise\s*\{/);
    expect(threadCss).toMatch(/@keyframes sug-in\s*\{/);
    expect(threadCss).toMatch(/:root:not\(\[data-still\]\) \.thread \.fresh/);
    expect(threadCss).toMatch(/animation:\s*rise var\(--t-enter\) var\(--ease-enter\) both/);
    expect(threadCss).toMatch(/:root:not\(\[data-still\]\) \.thread \.suggestion-row/);
    expect(threadCss).toMatch(/animation:\s*sug-in 0\.3s var\(--ease-enter\) both 0\.15s/);
    expect(threadCss).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.thread \.fresh[\s\S]*animation:\s*none/);
    expect(threadCss).toMatch(/:root\[data-still\] \.thread \.fresh/);
    expect(threadCss).toMatch(/:root\[data-still\] \.thread \.suggestion-row/);
  });

  it("lets place pages enter with enter11 and the same guards", () => {
    expect(frameCss).toMatch(/@keyframes enter11\s*\{/);
    expect(frameCss).toMatch(/:root:not\(\[data-still\]\) \.enter11 > \*/);
    expect(frameCss).toMatch(/animation:\s*enter11 var\(--t-enter\) var\(--ease-enter\) both/);
    expect(frameCss).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.enter11 > \*[\s\S]*animation:\s*none/);
    expect(frameCss).toMatch(/:root\[data-still\] \.enter11 > \*/);
    expect(placeView).toMatch(/className="enter11"/);
    expect(placeView).toMatch(/key=\{place\}/);
    expect(placeView).toMatch(/<div className="enter11" key=\{place\}>[\s\S]*<\/div>\s*<TrunkHost/);
  });

  it("keeps the preview pin-in timing of 250ms ease", () => {
    expect(contactsCss).toMatch(/\.pin-new\s*\{\s*animation:\s*pin-in 250ms ease both/);
    expect(contactsCss).toMatch(/@keyframes pin-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*scale\(\.94\)/);
    expect(contactsCss).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.pin-new[\s\S]*animation:\s*none/);
    expect(mainTsx).not.toMatch(/motion\.css/);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Mark({ id }: { id: string }) {
  return createElement("span", { "data-testid": id, className: useFreshClass(id) });
}

function Wave({ session, ids }: { session: string; ids: string[] }) {
  return createElement(
    ThreadContext.Provider,
    { value: { name: "Oak", toast: () => undefined, running: false, sessionKey: session } },
    ...ids.map((id) => createElement(Mark, { key: id, id })),
  );
}

describe("fresh marks", () => {
  let root: Root | undefined;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    resetFreshMarks();
  });

  it("rises only messages that arrive after the conversation is already on screen", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(createElement(Wave, { session: "chat-a", ids: ["u1", "r1"] })));
    expect(host.querySelector('[data-testid="u1"]')?.className).toBe("");
    expect(host.querySelector('[data-testid="r1"]')?.className).toBe("");
    await act(async () => root?.render(createElement(Wave, { session: "chat-a", ids: ["u1", "r1", "u2"] })));
    expect(host.querySelector('[data-testid="u1"]')?.className).toBe("");
    expect(host.querySelector('[data-testid="u2"]')?.className).toBe(" fresh");
  });
});
