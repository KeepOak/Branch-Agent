// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from "react";
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

type Props = ComponentProps<typeof PlusMenu>;
const trunks: Props["trunks"] = [
  { id: "research", name: "Research", defaultMode: "ask", theme: "", model: "" },
  { id: "builder", name: "Builder", defaultMode: "ask", theme: "", model: "" },
];
const TOP = ["Attach files", "Add a folder", "Take a photo", "Record a voice note", "Mention a Trunk", "Use a skill", "More…"];
const NO_ROUTE_ROWS = ["From Google Drive", "From OneDrive or SharePoint", "Take a screenshot", "Saved prompts", "Write a document, spreadsheet or slides", "Find a GIF…", "Improve my draft", "Check with me"];

async function renderMenu(extra: Partial<Props> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  const spies = {
    onClose: vi.fn(), onAttach: vi.fn(), onFolder: vi.fn(), onPhoto: vi.fn(), onInsert: vi.fn(), onBackground: vi.fn(),
    onWhoAnswers: vi.fn(), onTemporary: vi.fn(), onOpen: vi.fn(),
  };
  const props: Props = { anchor: createRef<HTMLElement>(), trunks, trunkId: "research", temporary: false, ...spies, ...extra };
  root = createRoot(host);
  await act(async () => root?.render(<PlusMenu {...props} />));
  return { host, spies };
}

const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".c-mi")];
const labelOf = (row: HTMLElement) => row.querySelector(".c-mi-t > span")?.textContent ?? "";
const labels = (host: HTMLElement) => rows(host).map(labelOf);
const rowNamed = (host: HTMLElement, label: string) => {
  const row = rows(host).find((r) => labelOf(r) === label);
  if (!row) throw new Error(`no row "${label}" in the open view`);
  return row;
};
async function press(row: HTMLElement) {
  await act(async () => row.click());
}
async function openMore(host: HTMLElement) {
  await press(rowNamed(host, "More…"));
}

describe("P54 composer plus menu", () => {
  it("opens with six actions and a More… row, with nothing greyed", async () => {
    const { host } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    expect(labels(host)).toEqual(TOP);
    expect(rows(host).filter((r) => r.hasAttribute("disabled"))).toHaveLength(0);
  });

  it("keeps the top actions working and closes the menu", async () => {
    const { host, spies } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    await press(rowNamed(host, "Add a folder"));
    expect(spies.onFolder).toHaveBeenCalledOnce();
    expect(spies.onClose).toHaveBeenCalledOnce();
    await press(rowNamed(host, "Mention a Trunk"));
    expect(spies.onInsert).toHaveBeenCalledWith("@");
  });

  it("never lists the rows that have no route, in either view", async () => {
    const { host } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    for (const name of NO_ROUTE_ROWS) expect(labels(host)).not.toContain(name);
    await openMore(host);
    for (const name of NO_ROUTE_ROWS) expect(labels(host)).not.toContain(name);
  });

  it("shows the rest under More… with a Back row and a This conversation heading", async () => {
    const { host } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    await openMore(host);
    expect(labels(host)).toEqual([
      "Back", "Set a goal", "Make a picture", "Run it in the background",
      "Phone call…", "Join a meeting…", "Research", "Builder", "Temporary conversation",
    ]);
    expect([...host.querySelectorAll(".c-ph")].map((x) => x.textContent)).toEqual(["This conversation", "Who answers here"]);
  });

  it("moves focus into the More… view, does not close the menu, and Back returns to the top", async () => {
    const { host, spies } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    await openMore(host);
    expect(spies.onClose).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain("Back");
    await press(rowNamed(host, "Back"));
    expect(labels(host)).toEqual(TOP);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("plus-more");
  });

  it("keeps Make a picture and Record a voice note greyed, with a reason, when their handlers are absent", async () => {
    const { host } = await renderMenu({ onPicture: undefined, onVoiceNote: undefined });
    expect(labels(host)).toEqual(TOP);
    const voice = rowNamed(host, "Record a voice note");
    expect(voice.hasAttribute("disabled")).toBe(true);
    expect(voice.getAttribute("title")).toBeTruthy();
    await openMore(host);
    const picture = rowNamed(host, "Make a picture");
    expect(picture.hasAttribute("disabled")).toBe(true);
    expect(picture.getAttribute("title")).toContain("Settings › Models");
  });

  it("keeps Temporary conversation greyed, with a reason a person can read, when it cannot start", async () => {
    const { host } = await renderMenu({ onTemporary: undefined, onPicture: vi.fn() });
    await openMore(host);
    const row = rowNamed(host, "Temporary conversation");
    expect(row.querySelector("[role=switch]")?.hasAttribute("disabled")).toBe(true);
    expect(row.getAttribute("title")).toBeTruthy();
    expect(row.getAttribute("title")).not.toMatch(/engine/i);
  });

  it("gives every greyed row in both views a visible reason", async () => {
    const { host } = await renderMenu({ onOpen: undefined, onWhoAnswers: undefined, onPicture: undefined, onVoiceNote: undefined, onTemporary: undefined });
    const greyed = () => [...host.querySelectorAll<HTMLElement>(".c-mi[disabled], .c-switch[disabled]")];
    expect(greyed().length).toBeGreaterThan(0);
    for (const row of greyed()) expect(row.getAttribute("title")).toBeTruthy();
    await openMore(host);
    expect(greyed().length).toBeGreaterThan(0);
    for (const row of greyed()) expect(row.getAttribute("title")).toBeTruthy();
  });

  it("keeps Who answers and Temporary wired to their handlers", async () => {
    const { host, spies } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    await openMore(host);
    await press(rowNamed(host, "Builder"));
    expect(spies.onWhoAnswers).toHaveBeenCalledWith("builder");
    await press(host.querySelector<HTMLElement>(".c-switch")!);
    expect(spies.onTemporary).toHaveBeenCalledOnce();
  });

  it("shows one trigger chip per shortcut, the same way in both views", async () => {
    const { host } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    const chip = (label: string) => rowNamed(host, label).querySelector(".c-mi-r kbd")?.textContent;
    expect(chip("Mention a Trunk")).toBe("@");
    expect(chip("Use a skill")).toBe("/");
    await openMore(host);
    expect(chip("Set a goal")).toBe("/goal");
    expect(chip("Run it in the background")).toBe("/bg");
  });

  it("keeps /goal inserting its text", async () => {
    const { host, spies } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    await openMore(host);
    await press(rowNamed(host, "Set a goal"));
    expect(spies.onInsert).toHaveBeenCalledWith("/goal ");
    expect(spies.onClose).toHaveBeenCalledOnce();
  });

  it("keeps /bg starting the background run and closing the menu", async () => {
    const { host, spies } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    await openMore(host);
    await press(rowNamed(host, "Run it in the background"));
    expect(spies.onBackground).toHaveBeenCalledOnce();
    expect(spies.onClose).toHaveBeenCalledOnce();
  });

  it("keeps the testids the shell and button crawl rely on", async () => {
    const { host } = await renderMenu({ onPicture: vi.fn(), onVoiceNote: vi.fn() });
    for (const id of ["plus-attach", "plus-photo", "plus-voice-note"]) expect(host.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    await openMore(host);
    expect(host.querySelector('[data-testid="plus-background"]')).not.toBeNull();
  });
});
