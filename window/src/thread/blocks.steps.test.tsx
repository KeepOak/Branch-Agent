// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { resetStepsFoldChoice, StepsFold } from "./blocks";
import { ThreadContext } from "./context";
import type { Block } from "./model";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  resetStepsFoldChoice();
});

type Step = Extract<Block, { kind: "step" }>;

const step = (patch: Partial<Step> & Pick<Step, "key" | "tool">): Step => ({
  kind: "step",
  title: "",
  detail: "",
  status: "ok",
  ...patch,
});

async function renderFold(steps: Step[], live = false) {
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "thread";
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ThreadContext.Provider value={{ name: "Sapling", toast: () => undefined, running: live }}>
        <StepsFold steps={steps} live={live} />
      </ThreadContext.Provider>,
    ),
  );
  return host;
}

describe("preview step rows", () => {
  it("shows a kind icon, plain title and muted detail, with state on the right", async () => {
    const host = await renderFold([
      step({ key: "r", tool: "read", title: "src/dates.test.ts", status: "ok" }),
      step({ key: "c", tool: "bash", title: "pnpm vitest run src/dates.test.ts", status: "failed", detail: "Exit 1" }),
      step({ key: "s", tool: "web_search", title: "date-fns: formatting in a time zone", status: "ok" }),
    ]);
    const rows = [...host.querySelectorAll('[data-testid="step"]')];
    expect(rows[0]?.getAttribute("data-step-kind")).toBe("read");
    expect(rows[0]?.querySelector('[data-testid="step-icon"]')?.getAttribute("data-kind")).toBe("read");
    expect(rows[0]?.querySelector(".step-label")?.textContent).toBe("Read a file");
    expect(rows[0]?.querySelector(".step-detail")?.textContent).toBe("src/dates.test.ts");
    expect(rows[0]?.querySelector(".step-state")?.textContent).toBe("Done");
    expect(rows[1]?.getAttribute("data-step-kind")).toBe("run");
    expect(rows[1]?.querySelector('[data-testid="step-icon"]')?.getAttribute("data-kind")).toBe("run");
    expect(rows[1]?.querySelector(".step-state")?.textContent).toContain("Failed");
    expect(rows[2]?.getAttribute("data-step-kind")).toBe("search");
  });

  it("shows the last 4 output lines, an Exit code pill, and the three output actions", async () => {
    const output = ["RUN  v3.2.1 garden-site", "× formats the day", "  Expected: \"Oct 2\"", "  Received: \"Oct 1\"", "Test Files  1 failed (1)", "     Tests  1 failed | 11 passed (12)"].join("\n");
    const host = await renderFold([
      step({ key: "fail", tool: "bash", title: "pnpm vitest run src/dates.test.ts", status: "failed", detail: "Exit 1", output }),
    ]);
    const card = host.querySelector('[data-testid="step-output"]') as HTMLElement;
    expect(card.querySelector("pre")?.textContent?.split("\n")).toEqual([
      "  Expected: \"Oct 2\"",
      "  Received: \"Oct 1\"",
      "Test Files  1 failed (1)",
      "     Tests  1 failed | 11 passed (12)",
    ]);
    expect(card.querySelector(".pill.no")?.textContent).toBe("Exit code 1");
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Show full output",
      "Copy output",
      "Save output",
    ]);
    await act(async () => { (card.querySelector("button") as HTMLButtonElement).click(); });
    expect(host.querySelector('[data-testid="step-full-output"]')?.textContent).toContain("RUN  v3.2.1 garden-site");
  });

  it("says No output · it finished or it failed, with no output card", async () => {
    const host = await renderFold([
      step({ key: "ok", tool: "bash", title: "pnpm vitest run src/dates.test.ts", status: "ok", output: "" }),
      step({ key: "bad", tool: "bash", title: "false", status: "failed", detail: "Exit 1", output: "" }),
    ]);
    const rows = [...host.querySelectorAll('[data-testid="step"]')];
    expect(rows[0]?.querySelector(".nout-pb18")?.textContent).toBe("No output · it finished.");
    expect(rows[1]?.querySelector(".nout-pb18")?.textContent).toBe("No output · it failed.");
    expect(rows[0]?.querySelector('[data-testid="step-output"]')).toBeNull();
  });

  it("does not show No output on a read or edit step that has no output field", async () => {
    const host = await renderFold([
      step({ key: "r", tool: "read", title: "src/dates.test.ts", status: "ok" }),
      step({
        key: "e",
        tool: "apply_patch",
        title: "src/dates.ts",
        status: "ok",
        changes: [{ path: "src/dates.ts", added: 1, removed: 0, diff: "+ok" }],
      }),
    ]);
    expect(host.querySelector(".nout-pb18")).toBeNull();
    expect(host.querySelector('[data-testid="step-output"]')).toBeNull();
    expect(host.querySelector('[data-testid="files-changed"]')).not.toBeNull();
  });

  it("toggles a file card between Diff and Raw and labels failed edits Attempted changes", async () => {
    const changes = [
      { path: "src/dates.ts", added: 3, removed: 1, diff: "@@ -1 +1 @@\n export function format(day: Date) {\n-  return day.toLocaleDateString();\n+  return day.toLocaleDateString(\"en-US\", { timeZone: \"UTC\" });\n }" },
      { path: "src/dates.test.ts", added: 1, removed: 1, diff: "-const day = new Date(2026, 9, 2);\n+const day = new Date(Date.UTC(2026, 9, 2));" },
    ];
    const host = await renderFold([
      step({ key: "edit", tool: "apply_patch", title: "src/dates.ts, src/dates.test.ts", status: "failed", changes }),
    ]);
    const card = host.querySelector('[data-testid="files-changed"]') as HTMLElement;
    expect(card.querySelector(".card-h")?.textContent).toBe("Attempted changes");
    expect(card.textContent).toContain("src/dates.ts");
    expect(card.textContent).toContain("+3");
    expect(card.textContent).toContain("−1");
    expect(card.querySelector('[data-testid="file-diff"]')?.textContent).toContain("return day.toLocaleDateString();");
    expect(card.querySelector('[data-testid="file-diff"] .del')?.textContent).toMatch(/^- /);
    const rawBtn = [...card.querySelectorAll(".seg button")].find((b) => b.textContent === "Raw") as HTMLButtonElement;
    await act(async () => { rawBtn.click(); });
    expect(card.querySelector('[data-testid="file-raw"]')?.textContent).not.toContain("- ");
    expect(card.querySelector('[data-testid="file-raw"]')?.textContent).toContain("timeZone: \"UTC\"");
    expect(card.querySelector(".seg button[aria-pressed=\"true\"]")?.textContent).toBe("Raw");
  });

  it("shows list_windows as Listed open windows and never the raw action name", async () => {
    const host = await renderFold([
      step({ key: "w", tool: "computer", title: "list_windows", status: "ok", detail: "Checked what's open on the computer" }),
      step({ key: "u", tool: "computer", title: "frob_widget", status: "ok" }),
    ]);
    const rows = [...host.querySelectorAll('[data-testid="step"]')];
    expect(rows[0]?.querySelector(".step-label")?.textContent).toBe("Listed open windows");
    expect(rows[0]?.querySelector(".step-detail")).toBeNull();
    expect(rows[1]?.querySelector(".step-label")?.textContent).toBe("Used the computer");
    expect(host.textContent).not.toContain("list_windows");
    expect(host.textContent).not.toContain("frob_widget");
  });

  it("shows screen-tool actions as their own labels and never Used the computer", async () => {
    const host = await renderFold([
      step({ key: "d", tool: "screen", title: "desktop_show", status: "ok" }),
      step({ key: "b", tool: "screen", title: "browser_show", status: "ok" }),
      step({ key: "s", tool: "screen", title: "split_right", status: "ok" }),
      step({ key: "u", tool: "screen", title: "frob_pane", status: "ok" }),
    ]);
    const rows = [...host.querySelectorAll('[data-testid="step"]')];
    expect(rows[0]?.querySelector(".step-label")?.textContent).toBe("Showed the desktop");
    expect(rows[1]?.querySelector(".step-label")?.textContent).toBe("Showed the browser");
    expect(rows[2]?.querySelector(".step-label")?.textContent).toBe("Split the screen");
    expect(rows[3]?.querySelector(".step-label")?.textContent).toBe("Used the screen");
    expect(host.textContent).not.toContain("Used the computer");
    expect(host.textContent).not.toContain("desktop_show");
    expect(host.textContent).not.toContain("browser_show");
    expect(host.textContent).not.toContain("split_right");
    expect(host.textContent).not.toContain("frob_pane");
    expect(rows.every((row) => !row.querySelector(".step-detail"))).toBe(true);
  });

  it("renders expanded input as key: value lines, never JSON braces", async () => {
    const host = await renderFold([
      step({
        key: "pub",
        tool: "github_publish",
        title: "KeepOak/x",
        status: "running",
        input: '{\n  "repo": "KeepOak/x",\n  "draft": true\n}',
      }),
    ]);
    const input = host.querySelector('[data-testid="step-input"]') as HTMLElement;
    expect(input.textContent).toContain("repo: KeepOak/x");
    expect(input.textContent).toContain("draft: true");
    expect(input.textContent).not.toMatch(/[{}]/);
    expect(input.textContent).not.toContain('"draft"');
  });

  it("keeps the steps fold open after a live run finishes if the person left it open", async () => {
    const steps = [step({ key: "s1", tool: "read", title: "src/dates.test.ts" })];
    const host = await renderFold(steps, true);
    const fold = host.querySelector(".steps-fold") as HTMLDetailsElement;
    expect(fold.open).toBe(true);
    await act(async () => {
      root!.render(
        <ThreadContext.Provider value={{ name: "Sapling", toast: () => undefined, running: false }}>
          <StepsFold steps={steps} live={false} run={{ title: "Read, ran and changed 2 files", durationMs: 108_000 }} />
        </ThreadContext.Provider>,
      );
    });
    expect((host.querySelector(".steps-fold") as HTMLDetailsElement).open).toBe(true);
  });

  it("keeps the steps fold closed after a live run finishes if the person closed it", async () => {
    const steps = [step({ key: "s2", tool: "read", title: "src/dates.test.ts" })];
    const host = await renderFold(steps, true);
    const fold = host.querySelector(".steps-fold") as HTMLDetailsElement;
    await act(async () => {
      fold.open = false;
      fold.dispatchEvent(new Event("toggle"));
    });
    expect(fold.open).toBe(false);
    await act(async () => {
      root!.unmount();
      root = createRoot(host);
      root.render(
        <ThreadContext.Provider value={{ name: "Sapling", toast: () => undefined, running: false }}>
          <StepsFold steps={steps} live={false} />
        </ThreadContext.Provider>,
      );
    });
    expect((host.querySelector(".steps-fold") as HTMLDetailsElement).open).toBe(false);
  });
});

describe("file card Open file", () => {
  it("dispatches branch:open-file with the path", async () => {
    const seen: string[] = [];
    const onOpen = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (path) seen.push(path);
    };
    window.addEventListener("branch:open-file", onOpen);
    try {
      const host = await renderFold([
        step({
          key: "e",
          tool: "apply_patch",
          title: "src/dates.ts",
          changes: [{ path: "src/dates.ts", added: 1, removed: 0, diff: "+ok" }],
        }),
      ]);
      await act(async () => {
        [...host.querySelectorAll("button")].find((b) => b.textContent === "Open file")?.click();
      });
      expect(seen).toEqual(["src/dates.ts"]);
    } finally {
      window.removeEventListener("branch:open-file", onOpen);
    }
  });
});
