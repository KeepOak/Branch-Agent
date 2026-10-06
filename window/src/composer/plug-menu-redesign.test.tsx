// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlugMenu } from "./PlugMenu";
import type { WindowEngine } from "./engine";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("P54 plug popover", () => {
  it("shows real catalog counts, a single-line 60-character description and plain-language add labels", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") return { config: { mcp: { servers: { files: { command: "fileserver" } } } } };
      if (method === "skills.status") return { skills: [{ name: "Reader", description: "Read and classify documents from the owner's connected workspace without changing any files", eligible: true }] };
      if (method === "tools.effective") return { groups: [] };
      return {};
    });
    const engine: WindowEngine = { sessionKey: "agent:research:main", agentId: "research", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: [] };
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<PlugMenu anchor={createRef()} onClose={() => {}} engine={engine} row={{}} trunkName="Research" isAdmin patch={async () => null} />));
    expect([...host.querySelectorAll(".c-ph")].map((x) => x.textContent)).toEqual(["Connectors1 on", "Skills1 on"]);
    const description = [...host.querySelectorAll(".c-tool-t small")].find((x) => x.textContent?.startsWith("Read and classify"));
    expect(description?.textContent?.length).toBeLessThanOrEqual(60);
    expect(host.textContent).toContain("Command-line tool");
    expect(host.textContent).not.toContain("CLI");
  });
});
