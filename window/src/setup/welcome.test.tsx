// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WindowEngine } from "../connect/engine";
import { WelcomeHero } from "./SetupBrand";
import { SetupFlow } from "./SetupFlow";
import { WELCOME_PROMISE, WELCOME_SAFETY_LINES, WELCOME_SAFETY_TITLE } from "./steps-early";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  sessionStorage.clear();
});

async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

function engine() {
  const request = vi.fn(async () => ({}));
  return { request, onEvent: () => () => {}, sessionKey: "k", scopes: ["operator.admin"], agentId: "main" } as unknown as WindowEngine;
}

const tid = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

describe("Welcome", () => {
  it("shows the preview safety copy and holds Start until the promise is ticked", async () => {
    const host = await show(<SetupFlow engine={engine()} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.querySelector("h2")?.textContent).toBe("Hi, I’m Branch.");
    expect(host.textContent).toContain("An assistant that lives on this computer, with Trunks that each take one job. This takes about three minutes; you can change everything later.");
    expect(host.textContent).toContain(WELCOME_SAFETY_TITLE);
    for (const line of WELCOME_SAFETY_LINES) expect(host.textContent).toContain(line);
    expect(host.textContent).toContain(WELCOME_PROMISE);
    expect(host.textContent).not.toContain("You choose how much Branch asks before it acts.");
    expect(tid(host, "setup-next").disabled).toBe(true);
    expect(tid(host, "setup-next").textContent).toBe("Start");
    expect(tid(host, "setup-skip")).toBeNull();
    const later = [...host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")].slice(1);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((b) => b.disabled)).toBe(true);
    await act(async () => tid(host, "setup-promise").click());
    expect(tid(host, "setup-next").disabled).toBe(false);
    expect(later.every((b) => b.disabled)).toBe(false);
    await act(async () => tid(host, "setup-next").click());
    expect(host.querySelector("h2")?.textContent).toBe("Where should Branch run?");
    expect(host.querySelector('[data-testid="setup-welcome-mark"]')).toBeNull();
  });

  it("draws the Welcome mark in the text colour with no tile", () => {
    const markup = renderToStaticMarkup(<WelcomeHero />);
    expect(markup).toContain('data-testid="setup-welcome-mark"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain("keepoak-mark-mono-white-1024.png");
    expect(markup).not.toContain("keepoak-app-icon");
    expect(markup).not.toContain("background:");
  });
});
