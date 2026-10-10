// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { helpMenuItems } from "./help-menu";
import { PersonMenu } from "./PersonMenu";
import { TopBar, type HeaderInfo } from "./TopBar";

vi.mock("../face/Pebble", () => ({ Pebble: () => <span aria-hidden="true" /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

/** Every control a person could read as help: a Help, Guide or "?" button, or a menu row of that kind. */
const helpControls = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>("button")).filter((button) => {
  const words = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent].join(" ").trim();
  return /\b(help|guide)\b/i.test(words) || /^\?$/.test(button.textContent?.trim() ?? "") || /keyboard shortcuts|set up branch|about branch/i.test(words);
});

const header: HeaderInfo = { name: "Juniper", trunkName: "Juniper", state: "wait", isDefaultTrunk: false, renaming: false, onRename: () => {} };

describe("the one Help control", () => {
  it("draws one Help button on a page and in a conversation, and it opens a menu", async () => {
    const onHelp = vi.fn();
    const page = await mount(<TopBar compact={false} machine={null} header={null} dark={false} listHidden={false} onToggleList={vi.fn()} onHelp={onHelp} ask={{ name: "Sapling", open: false, onToggle: vi.fn() }} />);
    const controls = helpControls(page);
    expect(controls).toHaveLength(1);
    expect(controls[0].textContent).toBe("Help");
    expect(controls[0].getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => controls[0].click());
    expect(onHelp).toHaveBeenCalledOnce();
    await act(async () => root?.render(<TopBar compact={false} machine={null} header={header} dark={false} listHidden={false} onToggleList={vi.fn()} onHelp={onHelp} />));
    expect(helpControls(page)).toHaveLength(1);
  });

  it("keeps help out of the profile menu", async () => {
    const host = await mount(<PersonMenu at={{ x: 0, y: 0 }} person="Sam" theme="light" onTheme={vi.fn()} onSettings={vi.fn()} onAchievements={vi.fn()} onApps={vi.fn()} onClose={vi.fn()} onAddPerson={vi.fn()} onLock={vi.fn()} />);
    expect(host.ownerDocument.querySelector('[data-testid="person-menu"]')).not.toBeNull();
    expect(helpControls(host.ownerDocument.body)).toHaveLength(0);
  });

  it("holds the guide, keyboard shortcuts, docs and contact, plus the page's own help on a Settings page", () => {
    const run = vi.fn();
    const links = [{ label: "Docs", run }, { label: "Get help", run }];
    const base = { walkthrough: run, setup: run, news: run, canDo: run, shortcuts: run, links };
    const labels = (items: ReturnType<typeof helpMenuItems>) => items.map((item) => "label" in item ? item.label : "---");
    expect(labels(helpMenuItems(base))).toEqual(["Take the walkthrough", "Set up Branch", "What’s new", "What Branch can do", "Keyboard shortcuts", "---", "Docs", "Get help"]);
    const pageHelp = vi.fn();
    const settings = helpMenuItems({ ...base, pageHelp });
    expect(labels(settings).slice(0, 2)).toEqual(["Help for this page", "---"]);
    const first = settings[0];
    if (!("run" in first)) throw new Error("Help for this page should run");
    first.run();
    expect(pageHelp).toHaveBeenCalledOnce();
  });
});
