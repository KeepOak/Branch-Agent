// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComputerActivityCard } from "./ComputerActivityCard";
import { announceComputerControl } from "./computer-card";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "./model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
const step = (key: string, title: string, status: "ok" | "running" | "failed" | "denied", tool = "computer", outputKey?: string): Block => ({
  kind: "step",
  key,
  tool,
  title,
  detail: `${title} detail`,
  status,
  ...(outputKey ? { outputKey } : {}),
});
function engineWith(send?: WindowEngine["send"]): WindowEngine {
  return {
    sessionKey: "agent:main:main",
    scopes: [],
    onEvent: () => () => {},
    request: (async () => ({})) as WindowEngine["request"],
    send,
  };
}
async function render(
  blocks: Block[],
  running: boolean,
  onWatch = vi.fn(),
  engine?: WindowEngine,
  extras?: { controlling?: boolean; onHandBack?: () => void },
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ComputerActivityCard
        blocks={blocks}
        running={running}
        name="Ada"
        onWatch={onWatch}
        engine={engine}
        gatewayUrl={engine ? "ws://127.0.0.1:9" : undefined}
        controlling={extras?.controlling}
        onHandBack={extras?.onHandBack}
      />,
    ),
  );
  return onWatch;
}
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`no button ${label}`);
  await act(async () => button.click());
  return button;
};

describe("computer card in the conversation", () => {
  it("groups finished actions and lists each one when opened", async () => {
    await render([step("a", "Opened mail", "ok"), step("b", "Clicked Sign in", "ok")], false);
    expect(container.textContent).toContain("Used Ada's computer · 2 actions");
    expect(container.textContent).toContain("Opened mail, Clicked Sign in");
    await act(async () => container.querySelector<HTMLButtonElement>(".acts-head-st")!.click());
    expect(container.querySelectorAll(".acts-list-st li")).toHaveLength(2);
  });
  it("shows the live card while a computer step runs, with Watch full size", async () => {
    const onWatch = await render([step("a", "Searching the inbox", "running")], true);
    expect(container.textContent).toContain("Working");
    await click("Watch full size");
    expect(onWatch).toHaveBeenCalledWith("Computer");
  });
  it("shows You have control and Hand back after Take over", async () => {
    const onWatch = await render([step("a", "Searching the inbox", "running")], true);
    await click("Take over");
    expect(onWatch).toHaveBeenCalledWith("Computer", true);
    expect(container.textContent).toContain("You have control");
    expect(container.textContent).toContain("Hand back to Ada");
    expect(container.textContent).toContain("Open full size");
    expect(container.querySelector("[data-state='yours']")).toBeTruthy();
    await click("Open full size");
    expect(onWatch).toHaveBeenCalledWith("Computer");
    await click("Hand back to Ada");
    expect(container.textContent).toContain("Working");
    expect(container.textContent).toContain("Watch full size");
  });
  it("shows Stopped and Carry on when the run was stopped", async () => {
    const send = vi.fn(async () => undefined);
    await render(
      [step("a", "Opened mail", "ok", "computer", "r:a"), { kind: "done", key: "d", runId: "r", stopped: true }],
      false,
      vi.fn(),
      engineWith(send),
    );
    expect(container.textContent).toContain("Stopped");
    expect(container.textContent).not.toContain("Used Ada's computer");
    await click("Carry on");
    expect(send).toHaveBeenCalledWith("Carry on");
  });
  it("shows Done when the computer work finished", async () => {
    await render([step("a", "Opened mail", "ok")], false);
    expect(container.querySelector("[data-state='done']")?.textContent).toContain("Done");
    expect(container.textContent).toContain("Used Ada's computer · 1 action");
  });
  it("shows one finished card, not a Done card and a Used card", async () => {
    await render([step("a", "Opened mail", "ok"), step("b", "Clicked Sign in", "ok")], false);
    expect(container.querySelectorAll(".acts-card-st, .comp-card-st")).toHaveLength(1);
    expect(container.querySelector(".comp-card-st")).toBeNull();
    expect(container.querySelector(".acts-card-st")?.textContent).toContain("Used Ada's computer · 2 actions");
    expect(container.querySelector(".acts-card-st")?.textContent).toContain("Done");
  });
  it("notifies the parent when you hand back", async () => {
    const onHandBack = vi.fn();
    await render([step("a", "Searching the inbox", "running")], true, vi.fn(), undefined, {
      controlling: true,
      onHandBack,
    });
    expect(container.querySelector("[data-state='yours']")).toBeTruthy();
    await click("Hand back to Ada");
    expect(onHandBack).toHaveBeenCalledTimes(1);
  });
  it("is not yours after the stage closes", async () => {
    const blocks = [step("a", "Searching the inbox", "running")];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const mount = async (controlling: boolean) => {
      await act(async () =>
        root!.render(
          <ComputerActivityCard blocks={blocks} running={true} name="Ada" onWatch={vi.fn()} controlling={controlling} onHandBack={() => {}} />,
        ),
      );
    };
    await mount(true);
    expect(container.querySelector("[data-state='yours']")).toBeTruthy();
    await mount(false);
    expect(container.querySelector("[data-state='yours']")).toBeNull();
    expect(container.textContent).toContain("Working");
    expect(container.textContent).not.toContain("You have control");
  });
  it("is not yours after the stage announces that control was released", async () => {
    await render([step("a", "Searching the inbox", "running")], true);
    await click("Take over");
    expect(container.querySelector("[data-state='yours']")).toBeTruthy();
    await act(async () => announceComputerControl(false));
    expect(container.querySelector("[data-state='yours']")).toBeNull();
    expect(container.textContent).toContain("Working");
  });
  it("shows two finished turns as two Used folds, each with a Done pill", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <>
          <ComputerActivityCard blocks={[step("a", "Opened the garden site", "ok")]} running={true} name="Ada" onWatch={vi.fn()} />
          <ComputerActivityCard
            blocks={[step("b", "Clicked Sign in", "ok"), step("c", "Typed the email", "ok")]}
            running={true}
            name="Ada"
            onWatch={vi.fn()}
          />
        </>,
      ),
    );
    const cards = [...container.querySelectorAll(".acts-card-st, .comp-card-st")];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("Used Ada's computer · 1 action");
    expect(cards[0]?.textContent).toContain("Done");
    expect(cards[1]?.textContent).toContain("Used Ada's computer · 2 actions");
    expect(cards[1]?.textContent).toContain("Done");
  });
  it("leaves an earlier Done fold as Done when you take over the live card", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <>
          <ComputerActivityCard blocks={[step("a", "Opened mail", "ok")]} running={true} name="Ada" onWatch={vi.fn()} />
          <ComputerActivityCard blocks={[step("b", "Searching the inbox", "running")]} running={true} name="Ada" onWatch={vi.fn()} />
        </>,
      ),
    );
    expect(container.querySelectorAll("[data-state='done']")).toHaveLength(1);
    await click("Take over");
    expect(container.querySelector("[data-state='done']")?.textContent).toContain("Done");
    expect(container.querySelector("[data-state='yours']")?.textContent).toContain("You have control");
    expect(container.querySelectorAll("[data-state='yours']")).toHaveLength(1);
  });
  it("does not force a later live card to Stopped because an earlier turn was stopped", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const send = vi.fn(async () => undefined);
    await act(async () =>
      root!.render(
        <>
          <ComputerActivityCard
            blocks={[step("old", "Opened mail", "ok", "computer", "run-old:old"), { kind: "done", key: "d1", runId: "run-old", stopped: true }]}
            running={true}
            name="Ada"
            onWatch={vi.fn()}
            engine={engineWith(send)}
          />
          <ComputerActivityCard
            blocks={[step("now", "Searching the inbox", "running", "computer", "run-now:now")]}
            running={true}
            name="Ada"
            onWatch={vi.fn()}
          />
        </>,
      ),
    );
    const cards = [...container.querySelectorAll(".acts-card-st, .comp-card-st")];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("Stopped");
    expect(cards[0]?.textContent).toContain("Carry on");
    expect(cards[1]?.textContent).toContain("Working");
    expect(cards[1]?.textContent).not.toContain("Stopped");
  });
  it("shows list_windows as Listed open windows and Used Ada's computer", async () => {
    const listed: Block = {
      kind: "step",
      key: "a",
      tool: "computer",
      title: "list_windows",
      detail: "Checked what's open on the computer",
      status: "ok",
      outputKey: "r:a",
    };
    await render([listed, { kind: "done", key: "d", runId: "r" }], false);
    expect(container.textContent).toContain("Used Ada's computer · 1 action");
    expect(container.textContent).toContain("Listed open windows");
    expect(container.textContent).not.toContain("list_windows");
    expect(container.textContent).not.toContain("Used This computer");
    await act(async () => container.querySelector<HTMLButtonElement>(".acts-head-st")!.click());
    const row = container.querySelector(".acts-list-st li") as HTMLElement;
    expect(row.querySelector("b")?.textContent).toBe("Listed open windows");
    expect(row.querySelector("small")?.textContent).toBe("Checked what's open on the computer");
    expect(container.textContent).not.toContain("list_windows");
  });

  it("uses the fallback label for an unknown computer action", async () => {
    await render([step("a", "frob_widget", "ok")], false);
    expect(container.textContent).toContain("Used Ada's computer · 1 action");
    expect(container.textContent).toContain("Used the computer");
    expect(container.textContent).not.toContain("frob_widget");
    await act(async () => container.querySelector<HTMLButtonElement>(".acts-head-st")!.click());
    expect(container.querySelector(".acts-list-st li b")?.textContent).toBe("Used the computer");
    expect(container.textContent).not.toContain("frob_widget");
  });

  it("shows a screen-tool action as its own label, not Used the computer", async () => {
    await render([
      {
        kind: "step",
        key: "s",
        tool: "screen",
        title: "desktop_show",
        detail: "",
        status: "ok",
      },
    ], false);
    expect(container.textContent).toContain("Showed the desktop");
    expect(container.textContent).not.toContain("Used the computer");
    expect(container.textContent).not.toContain("desktop_show");
    await act(async () => container.querySelector<HTMLButtonElement>(".acts-head-st")!.click());
    expect(container.querySelector(".acts-list-st li b")?.textContent).toBe("Showed the desktop");
    expect(container.textContent).not.toContain("desktop_show");
  });

  it("keeps Used Ada's computer when the engine calls the host This computer", async () => {
    const engine: WindowEngine = {
      sessionKey: "agent:main:main",
      scopes: [],
      onEvent: () => () => {},
      request: (async (method: string) => {
        if (method === "sessions.describe") {
          return { session: { key: "agent:main:main", placement: { state: "local" } } };
        }
        if (method === "environments.status") return { id: "gateway", label: "Studio host" };
        return {};
      }) as WindowEngine["request"],
    };
    await render([step("a", "list_windows", "ok")], false, vi.fn(), engine);
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Used Ada's computer · 1 action");
    expect(container.textContent).toContain("Listed open windows");
    expect(container.textContent).not.toContain("Used This computer");
    expect(container.textContent).not.toContain("Used Studio host");
    expect(container.textContent).not.toContain("list_windows");
  });

  it("shows a live thumbnail and Take over for the browser", async () => {
    const onWatch = await render([step("a", "Opened the inbox", "running", "browser")], true, vi.fn(), engineWith());
    expect(container.querySelector("[aria-label='Open the browser full size']")).toBeTruthy();
    expect(container.textContent).toContain("Ada's browser");
    await click("Take over");
    expect(onWatch).toHaveBeenCalledWith("Browser", true);
    expect(container.textContent).toContain("You have control");
    expect(container.querySelector("[aria-label='Open the browser full size']")).toBeTruthy();
  });
});
