// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** Every control a person could read as help: a Help, Guide or "?" button, or a help row in a menu. */
const helpControls = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>("button")).filter((button) => {
  const words = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent].join(" ").trim();
  return /\b(help|guide)\b/i.test(words) || /^\?$/.test(button.textContent?.trim() ?? "") || /keyboard shortcuts|set up branch|about branch/i.test(words);
});

const header: HeaderInfo = { name: "Juniper", trunkName: "Juniper", state: "wait", isDefaultTrunk: false, renaming: false, onRename: () => {} };

describe("the one Help control", () => {
  it("draws one Help button on a Settings page and in a conversation, and it opens a menu", async () => {
    const onHelp = vi.fn();
    // What the shell hands the top bar on a Settings page. The Guide handler and the "?" page-help entry it passed
    // before this change are included so a second help control would show up here.
    const settingsPage = { compact: false, machine: null, header: null, dark: false, listHidden: false, onToggleList: vi.fn(), onHelp,
      onGuide: onHelp, ask: { name: "Sapling", open: false, help: true, onToggle: vi.fn() } } as unknown as ComponentProps<typeof TopBar>;
    const page = await mount(<TopBar {...settingsPage} ask={null} />);
    const controls = helpControls(page);
    expect(controls).toHaveLength(1);
    expect(controls[0].textContent).toBe("Help");
    expect(controls[0].getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => controls[0].click());
    expect(onHelp).toHaveBeenCalledOnce();
    await act(async () => root?.render(<TopBar {...settingsPage} />));
    expect(helpControls(page)).toHaveLength(1);
    await act(async () => root?.render(<TopBar {...settingsPage} header={header} ask={null} />));
    expect(helpControls(page)).toHaveLength(1);
  });

  it("keeps help out of the profile menu", async () => {
    const host = await mount(<PersonMenu at={{ x: 0, y: 0 }} person="Sam" theme="light" onTheme={vi.fn()} onSettings={vi.fn()} onAchievements={vi.fn()} onApps={vi.fn()} onClose={vi.fn()} onAddPerson={vi.fn()} onLock={vi.fn()} />);
    expect(host.ownerDocument.querySelector('[data-testid="person-menu"]')).not.toBeNull();
    expect(helpControls(host.ownerDocument.body)).toHaveLength(0);
  });
});
