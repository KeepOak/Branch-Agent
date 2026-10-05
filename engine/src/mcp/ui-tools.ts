import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Locator, Page } from "playwright-core";
import { z } from "zod";
import type { UiTarget, UiTargetKind } from "./ui-target.js";

/**
 * Eyes and hands on the Branch window for outside agents (`branch mcp serve` ui_* tools): see it as the owner does
 * (screenshot, accessibility snapshot with refs) and operate it (click, type, press, scroll, hover, wait, go to a
 * place). Refs and the snapshot are Playwright's AI aria snapshot, the same refs the browser extension's
 * pw-role-snapshot uses (`aria-ref=e12`). By default the tools drive a separate test Branch; the owner's own window
 * only after the owner turns it on, and it then shows "An agent is controlling this window" with a Stop button.
 */
export type UiOpen = (kind: UiTargetKind, opts?: { firstRun?: boolean }) => Promise<UiTarget>;

const BANNER_ID = "branch-agent-control";
const STOPPED_KEY = "branch-agent-control-stopped";
const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "menuitem",
  "tab",
  "slider",
  "searchbox",
  "option",
  "menuitemcheckbox",
  "menuitemradio",
  "spinbutton",
]);

/**
 * Interactive controls in an AI aria snapshot that have no accessible name: the window's labelling gaps.
 * The AI snapshot leaves the name out when it is just the control's own text, so a nameless control that
 * contains text (`- text: Welcome`, `- emphasis: "1"`) is named; one with only icons or nothing is not.
 */
export function unlabeledControls(snapshot: string): string[] {
  const lines = snapshot.split(/\r?\n/);
  const indent = (line: string) => line.length - line.trimStart().length;
  const out: string[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*- ([a-z]+)(?: "([^"]*)")?(.*)$/.exec(line);
    if (!match || !INTERACTIVE.has(match[1]!) || match[2]?.trim()) return;
    if (/:\s*\S/.test(match[3]!.replace(/\[[^\]]*\]/g, ""))) return;
    for (const child of lines.slice(index + 1)) {
      if (indent(child) <= indent(line)) break;
      if (
        /- text: \S|: "?[^"\s]|^\s*- [a-z]+ "[^"]+"/.test(child) &&
        !/^\s*- \/(url|placeholder):/.test(child)
      )
        return;
    }
    out.push(line.trim());
  });
  return out;
}

/** Put the banner up (once) and refuse to act after the owner pressed Stop. Runs inside the page (plain JS,
 *  since the engine is compiled without the DOM library). */
export const CONTROL_BANNER_JS = `(({ id, key }) => {
  if (sessionStorage.getItem(key) === "1") return "stopped";
  if (document.getElementById(id)) return "ok";
  const bar = document.createElement("div");
  bar.id = id;
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:12px;align-items:center;padding:8px 10px 8px 14px;border-radius:12px;background:#1f2937;color:#fff;font:500 13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)";
  const text = document.createElement("span");
  text.textContent = "An agent is controlling this window";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = "Stop";
  stop.setAttribute("aria-label", "Stop the agent controlling this window");
  stop.style.cssText = "border:0;border-radius:8px;padding:5px 12px;background:#dc2626;color:#fff;font:inherit;cursor:pointer";
  stop.addEventListener("click", () => { sessionStorage.setItem(key, "1"); bar.remove(); });
  bar.append(text, stop);
  document.body.append(bar);
  return "ok";
})`;

export class UiSession {
  private target: UiTarget | undefined;
  constructor(private readonly open: UiOpen) {}

  async page(kind?: UiTargetKind, opts?: { firstRun?: boolean }): Promise<Page> {
    if (kind && this.target && this.target.kind !== kind) await this.close();
    this.target ??= await this.open(kind ?? "test", opts);
    const page = this.target.page;
    const state = await page.evaluate(
      `${CONTROL_BANNER_JS}(${JSON.stringify({ id: BANNER_ID, key: STOPPED_KEY })})`,
    );
    if (state === "stopped") {
      throw new Error("The owner pressed Stop: agent control of this window has ended.");
    }
    return page;
  }

  info(): Record<string, string | number> | undefined {
    return this.target ? { target: this.target.kind, ...this.target.describe } : undefined;
  }

  async close(): Promise<void> {
    const target = this.target;
    this.target = undefined;
    await target?.close();
  }
}

/** A control by snapshot ref (e12) or by its accessible name (and role, when given). */
export function locate(page: Page, by: { ref?: string; name?: string; role?: string }): Locator {
  const ref = by.ref?.replace(/^@|^ref=/, "");
  if (ref) return page.locator(`aria-ref=${ref}`);
  if (!by.name) throw new Error("Give a ref from ui_snapshot or a name");
  if (by.role)
    return page.getByRole(by.role as Parameters<Page["getByRole"]>[0], { name: by.name }).first();
  return page
    .getByRole("button", { name: by.name })
    .or(page.getByRole("link", { name: by.name }))
    .or(page.getByRole("tab", { name: by.name }))
    .or(page.getByRole("menuitem", { name: by.name }))
    .or(page.getByLabel(by.name))
    .or(page.getByText(by.name, { exact: true }))
    .first();
}

const text = (value: string, extra: Record<string, unknown> = {}) => ({
  content: [{ type: "text" as const, text: value }],
  structuredContent: extra,
});
const target = {
  ref: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
};
const ACT_TIMEOUT_MS = 10_000;

export function registerUiMcpTools(server: McpServer, session: UiSession): void {
  registerUiSeeTools(server, session);
  registerUiActTools(server, session);
}

function registerUiSeeTools(server: McpServer, session: UiSession): void {
  server.tool(
    "ui_open",
    'Open the Branch window for the ui_* tools. "test" (default) starts a separate test Branch with its own engine and no owner data (first_run: true opens it on first-run setup); "owner" drives your real window and works only after the owner turns on "Let agents use this window".',
    { target: z.enum(["test", "owner"]).optional(), first_run: z.boolean().optional() },
    async ({ target: kind, first_run }) => {
      await session.page(kind ?? "test", { firstRun: first_run });
      return text(`opened the ${kind ?? "test"} Branch window`, session.info() ?? {});
    },
  );

  server.tool(
    "ui_close",
    "Close the test Branch (or let go of the owner's window).",
    {},
    async () => {
      await session.close();
      return text("closed");
    },
  );

  server.tool(
    "ui_screenshot",
    "A PNG screenshot of the Branch window, or of one control (ref or name).",
    { ...target, full_page: z.boolean().optional() },
    async ({ ref, name, role, full_page }) => {
      const page = await session.page();
      const image =
        ref || name
          ? await locate(page, { ref, name, role }).screenshot({ timeout: ACT_TIMEOUT_MS })
          : await page.screenshot({ fullPage: full_page ?? false });
      return {
        content: [
          { type: "image" as const, data: image.toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  server.tool(
    "ui_snapshot",
    "The window's accessibility tree: role, name, state and a ref per control (use the ref with ui_click and friends). Also lists controls that have no name.",
    { ...target },
    async ({ ref, name, role }) => {
      const page = await session.page();
      const scope = ref || name ? locate(page, { ref, name, role }) : page.locator("body");
      const snapshot =
        ref || name
          ? await scope.ariaSnapshot({ mode: "ai" })
          : await page.ariaSnapshot({ mode: "ai" });
      const unlabeled = unlabeledControls(snapshot);
      return text(snapshot, { url: page.url(), unlabeled });
    },
  );

  server.tool(
    "ui_wait_for",
    "Wait until text appears (or disappears with state hidden) in the window, up to timeout_ms.",
    {
      text: z.string().min(1),
      state: z.enum(["visible", "hidden"]).optional(),
      timeout_ms: z.number().int().min(100).max(120_000).optional(),
    },
    async ({ text: wanted, state, timeout_ms }) => {
      const page = await session.page();
      await page
        .getByText(wanted)
        .first()
        .waitFor({ state: state ?? "visible", timeout: timeout_ms ?? 15_000 });
      return text(`${wanted} is ${state ?? "visible"}`);
    },
  );
}

function registerUiActTools(server: McpServer, session: UiSession): void {
  server.tool(
    "ui_click",
    "Click a control by snapshot ref or accessible name.",
    { ...target, double: z.boolean().optional() },
    async ({ ref, name, role, double }) => {
      const control = locate(await session.page(), { ref, name, role });
      await (double
        ? control.dblclick({ timeout: ACT_TIMEOUT_MS })
        : control.click({ timeout: ACT_TIMEOUT_MS }));
      return text("clicked");
    },
  );

  server.tool(
    "ui_type",
    "Type into a field (ref or name; replaces its text unless append is true), or into whatever has focus.",
    { ...target, text: z.string(), append: z.boolean().optional(), submit: z.boolean().optional() },
    async ({ ref, name, role, text: value, append, submit }) => {
      const page = await session.page();
      if (ref || name) {
        const field = locate(page, { ref, name, role });
        if (append) await field.pressSequentially(value, { timeout: ACT_TIMEOUT_MS });
        else await field.fill(value, { timeout: ACT_TIMEOUT_MS });
      } else {
        await page.keyboard.type(value);
      }
      if (submit) await page.keyboard.press("Enter");
      return text("typed");
    },
  );

  server.tool(
    "ui_press",
    'Press a key or chord, such as "Enter", "Escape" or "Control+K".',
    { key: z.string().min(1) },
    async ({ key }) => {
      await (await session.page()).keyboard.press(key);
      return text(`pressed ${key}`);
    },
  );

  server.tool(
    "ui_hover",
    "Hover a control by ref or name.",
    { ...target },
    async ({ ref, name, role }) => {
      await locate(await session.page(), { ref, name, role }).hover({ timeout: ACT_TIMEOUT_MS });
      return text("hovered");
    },
  );

  server.tool(
    "ui_scroll",
    "Scroll the window, or the area under a control, by dy pixels (positive is down).",
    { ...target, dy: z.number().int().min(-20_000).max(20_000) },
    async ({ ref, name, role, dy }) => {
      const page = await session.page();
      if (ref || name) await locate(page, { ref, name, role }).hover({ timeout: ACT_TIMEOUT_MS });
      await page.mouse.wheel(0, dy);
      return text(`scrolled ${dy}`);
    },
  );

  server.tool(
    "ui_navigate",
    'Go to a place by clicking through it the way the owner would, such as "Settings › Usage" (each step is a control name), or "reload".',
    { path: z.string().min(1) },
    async ({ path }) => {
      const page = await session.page();
      if (path.trim().toLowerCase() === "reload") {
        await page.reload();
        return text("reloaded");
      }
      const steps = path.split(/\s*(?:›|>)\s*/).filter(Boolean);
      for (const step of steps) {
        await locate(page, { name: step }).click({ timeout: ACT_TIMEOUT_MS });
      }
      return text(`at ${steps.join(" › ")}`, { url: page.url() });
    },
  );
}
