// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Level } from "../../places-nav/level";
import { CustomizeLevelContext } from "./common";
import { KindHead, type Kind } from "./kind-chrome";
import type { ToolsCtx } from "./tools";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it.each(["regular", "advanced", "technical", "classic"] as const)("Personal Get more links respect Coming visibility at %s", async level => {
  const toCommunity = vi.fn();
  const ctx = { toCommunity } as unknown as ToolsCtx;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const heads = (["Toolsets", "Command-line tools", "Connectors", "Skills", "Plugins", "Agents"] as Kind[]).map(kind =>
    <KindHead key={kind} ctx={ctx} kind={kind} count="0"><p>No items yet.</p></KindHead>);
  await act(async () => root!.render(level === "classic" ? <>{heads}</> : <CustomizeLevelContext.Provider value={level as Level}>{heads}</CustomizeLevelContext.Provider>));
  const links = [...host.querySelectorAll<HTMLButtonElement>(".cz-get")];
  const comingShown = level === "technical" || level === "classic";
  for (const label of ["toolsets", "command-line tools"]) {
    expect(links.some(link => link.textContent === `＋ Get more ${label} in Community →`)).toBe(comingShown);
  }
  for (const label of ["connectors", "skills", "plugins", "agents & specialists"]) {
    expect(links.some(link => link.textContent === `＋ Get more ${label} in Community →`)).toBe(true);
  }
  const connector = links.find(link => link.textContent?.includes("Get more connectors"))!;
  await act(async () => connector.click());
  expect(toCommunity).toHaveBeenCalledWith("mcp");
});
