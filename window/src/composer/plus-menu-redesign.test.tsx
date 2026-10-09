// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlusMenu } from "./PlusMenu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("P54 composer plus menu", () => {
  it("explains the selected Trunk instead of offering an inert selection", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const select = vi.fn();
    await act(async () => root?.render(<PlusMenu anchor={createRef()} onClose={() => {}} trunks={[{ id: "builder", name: "Builder", defaultMode: "ask", theme: "", model: "" }, { id: "researcher", name: "Researcher", defaultMode: "ask", theme: "", model: "" }]} trunkId="builder"
      onAttach={() => {}} onFolder={() => {}} onPhoto={() => {}} onInsert={() => {}} onBackground={() => {}} onWhoAnswers={select} temporary={false} />));
    const selected = host.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')!;
    expect(selected.disabled).toBe(true);
    expect(selected.title).toBe("Builder already answers here.");
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="false"]')!.click());
    expect(select).toHaveBeenCalledWith("researcher");
  });
  it("groups Add, Insert, Make, Run and Who answers, with toggles last", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const onFolder = vi.fn();
    root = createRoot(host);
    await act(async () => root?.render(<PlusMenu anchor={createRef()} onClose={() => {}} trunks={[{ id: "research", name: "Research", defaultMode: "ask", theme: "", model: "" }]} trunkId="research"
      onAttach={() => {}} onFolder={onFolder} onPhoto={() => {}} onInsert={() => {}} onBackground={() => {}} temporary={false} />));
    expect([...host.querySelectorAll(".c-ph")].map((x) => x.textContent)).toEqual(["Add", "Insert", "Make", "Run", "Who answers here"]);
    const rows = [...host.querySelectorAll<HTMLElement>("[data-mi]")];
    expect(rows.map((x) => x.textContent).join(" ")).toContain("From Google Drive");
    expect(rows.map((x) => x.textContent).join(" ")).toContain("From OneDrive or SharePoint");
    const folder = rows.find((x) => x.textContent?.includes("Add a folder"));
    await act(async () => folder?.click());
    expect(onFolder).toHaveBeenCalledOnce();
    expect(host.textContent?.lastIndexOf("Temporary conversation")).toBeGreaterThan(host.textContent?.indexOf("Who answers here"));
  });
});
