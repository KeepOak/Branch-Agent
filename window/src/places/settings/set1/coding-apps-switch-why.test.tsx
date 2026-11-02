// @vitest-environment jsdom
// Accounts › Coding apps on this computer: every greyed coding app switch says why on a visible line, and names that
// line with aria-describedby. Claude Code and Gemini CLI follow their own app's sign-in, so their switch is always
// greyed; before, the reason sat only in a hover title.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { APPS, CodingApps } from "./coding-apps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPORT = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

function engineWith(detect: Record<string, unknown>, codexOn = false) {
  const request = vi.fn(async (method: string) => {
    if (method === "branch.setup.detect") return detect;
    if (method === "config.get")
      return {
        hash: "test",
        valid: true,
        config: { plugins: { entries: { codex: { enabled: codexOn } } } },
      };
    if (method === "usage.status") return { providers: [] };
    return {};
  });
  const engine: WindowEngine = {
    request: request as WindowEngine["request"],
    onEvent: () => () => {},
    sessionKey: "agent:main:main",
    agentId: "main",
    scopes: ["operator.admin"],
  };
  return engine;
}

async function show(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () =>
    root.render(
      <KitProvider level={level} report={REPORT} scope={null}>
        <CodingApps engine={engine} />
      </KitProvider>,
    ),
  );
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function sw(name: string) {
  const row = host.querySelector(`[data-row="${name}"]`);
  expect(row).not.toBeNull();
  const input = row!.querySelector<HTMLInputElement>("[role=switch]");
  expect(input).not.toBeNull();
  return { row: row!, input: input! };
}

/** The visible lines a greyed switch points to, in order. */
function reasons(name: string) {
  const { row, input } = sw(name);
  const ids = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  expect(ids.length).toBeGreaterThan(0);
  return ids.map((id) => {
    const el = document.getElementById(id);
    expect(el, id).not.toBeNull();
    expect(row.contains(el)).toBe(true);
    expect(el!.closest("[hidden], [aria-hidden=true]")).toBeNull();
    expect(el!.textContent?.trim()).not.toBe("");
    return el!.textContent;
  });
}

const ALL_READY = { candidates: APPS.map(({ kind }) => ({ kind, credentials: true })) };

describe("Greyed coding app switches say why", () => {
  it.each([0, 1, 2] as const)(
    "Claude Code and Gemini CLI name a visible line about their own sign-in at level %s",
    async (level) => {
      await show(engineWith(ALL_READY), level);
      for (const name of ["Claude Code", "Gemini CLI"]) {
        expect(sw(name).input.disabled).toBe(true);
        const lines = reasons(name);
        expect(lines).toContain(
          `Follows your sign-in in ${name} itself. Sign in or out there to change it.`,
        );
        expect(sw(name).row.textContent).toContain(`Follows your sign-in in ${name} itself.`);
        expect(sw(name).row.querySelector("[title]")).toBeNull();
      }
    },
  );

  it("says what to do when Claude Code and Gemini CLI are not found", async () => {
    await show(engineWith({ candidates: [] }));
    for (const name of ["Claude Code", "Gemini CLI"]) {
      expect(sw(name).input.disabled).toBe(true);
      expect(reasons(name)).toEqual([
        `Install and sign in to ${name} on this computer, then check again.`,
        `Follows your sign-in in ${name} itself. Sign in or out there to change it.`,
      ]);
    }
  });

  it("points a greyed Codex switch at its install and sign-in line", async () => {
    await show(
      engineWith({
        candidates: APPS.filter((app) => app.plugin !== "codex").map(({ kind }) => ({
          kind,
          credentials: true,
        })),
      }),
    );
    expect(sw("Codex").input.disabled).toBe(true);
    expect(reasons("Codex")).toEqual([
      "Install and sign in to Codex on this computer, then check again.",
    ]);
  });

  it("points a greyed Codex switch at its sign-in line when Codex needs a sign-in", async () => {
    await show(
      engineWith({
        candidates: APPS.map(({ kind }) => ({ kind, credentials: kind !== "codex-cli" })),
      }),
    );
    expect(sw("Codex").input.disabled).toBe(true);
    expect(reasons("Codex")).toEqual(["Open Codex and check its sign-in, then check again."]);
  });

  it("leaves a usable Codex switch without a greyed reason", async () => {
    await show(engineWith(ALL_READY, true));
    const { input } = sw("Codex");
    expect(input.disabled).toBe(false);
    expect(input.checked).toBe(true);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});
