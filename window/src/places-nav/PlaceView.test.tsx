// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { PlaceView } from "./PlaceView";
import type { PlaceId } from "./routes";

vi.mock("../places/automations", () => ({ AutomationsPlace: () => <div data-testid="place-automations" /> }));
vi.mock("../places/canopy", () => ({ CanopyPlace: () => <div data-testid="place-canopy" /> }));
vi.mock("../places/customize", () => ({ CustomizePlace: () => <div data-testid="place-customize" /> }));
vi.mock("../places/inbox", () => ({ InboxPlace: () => <div data-testid="place-inbox" /> }));
vi.mock("../places/library", () => ({ LibraryPlace: () => <div data-testid="place-library" /> }));
vi.mock("../places/overview", () => ({ OverviewPlace: () => <div data-testid="place-overview" /> }));
vi.mock("../places/people", () => ({ PeoplePlace: () => <div data-testid="place-people" /> }));
vi.mock("../places/office", () => ({ OfficePlace: () => <div data-testid="place-office" /> }));
vi.mock("../places/trunk", () => ({
  TrunkProfile: ({ agentId }: { agentId: string }) => <div data-testid="profile">{agentId}</div>,
  TrunkEditor: ({ agentId }: { agentId: string }) => <div data-testid="editor">{agentId}</div>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engine = { request: async () => ({}), onEvent: () => () => {}, sessionKey: null, scopes: [] } as unknown as WindowEngine;
const props = {
  engine,
  facts: { running: 0, waiting: 0 },
  openConversation: () => {},
  openPlace: () => {},
};

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function show(place: PlaceId) {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(<PlaceView place={place} {...props} />);
  });
}

const openTrunk = (detail: unknown) => act(async () => {
  window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail }));
});

describe("PlaceView", () => {
  it("mounts the R1 Seedbank screen for the seedbank place", async () => {
    await show("seedbank");
    expect(document.querySelector(".sb-title")?.textContent).toBe("Seedbank");
  });

  it("keeps Customize one tap away from the Seedbank place: Manage installed, then each Tools kind", async () => {
    const opened: string[] = [];
    const tabs: unknown[] = [];
    const onTab = (event: Event) => tabs.push((event as CustomEvent).detail);
    window.addEventListener("branch:place-tab", onTab);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<PlaceView place="seedbank" {...props} openPlace={place => opened.push(place)} />);
    });
    const manage = host.querySelector('[aria-label="Manage installed"]')!;
    const click = async (label: string) => {
      const button = [...manage.querySelectorAll("button")].find(b => b.textContent === label)!;
      await act(async () => button.click());
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    };
    await click("Manage installed");
    await click("Skills");
    window.removeEventListener("branch:place-tab", onTab);
    expect(opened).toEqual(["customize", "customize"]);
    expect(tabs).toEqual([{ place: "customize", tab: "Tools" }, { place: "customize", tab: "Skills" }]);
  });

  it("keeps TrunkHost mounted and an open profile or editor open across a place change", async () => {
    await show("overview");
    expect(document.querySelector("[data-testid=place-overview]")).toBeTruthy();
    await openTrunk({ agentId: "oak", view: "profile" });
    const profile = document.querySelector("[data-testid=profile]");
    expect(profile?.textContent).toBe("oak");
    await show("inbox");
    expect(document.querySelector("[data-testid=place-inbox]")).toBeTruthy();
    expect(document.querySelector("[data-testid=profile]")).toBe(profile);
    expect(document.querySelector("[data-testid=profile]")?.textContent).toBe("oak");
    await openTrunk({ agentId: "elm", view: "edit" });
    const editor = document.querySelector("[data-testid=editor]");
    expect(editor?.textContent).toBe("elm");
    await show("people");
    expect(document.querySelector("[data-testid=place-people]")).toBeTruthy();
    expect(document.querySelector("[data-testid=editor]")).toBe(editor);
    expect(document.querySelector("[data-testid=editor]")?.textContent).toBe("elm");
  });
});
