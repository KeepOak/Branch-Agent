// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ShareTrunkDialog, templateFileName } from "./ShareTrunk";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEMPLATE = { format: "branch.trunk-template", version: 1, name: "Night Shift", persona: { agentsMd: "# Night" }, skills: ["seedbank:@branch-agent/notes"], toolsets: {}, automations: [{ name: "Digest", cron: "0 7 * * *", prompt: "Summarize." }], permissions: [] };
const EXPORT = { file: "branch.trunk-template.json", template: TEMPLATE, link: "branch-template:1:abc", warnings: ['Routine "Ping" is not a scheduled prompt, so the template leaves it out.'] };

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function open(answer: unknown = EXPORT) {
  const request = vi.fn(() => answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ShareTrunkDialog engine={engine} agentId="night" name="Night Shift" onClose={() => {}} />); });
  await act(async () => { await Promise.resolve(); });
  return request;
}
const dialog = () => document.querySelector('[data-testid="share-trunk"]') as HTMLElement;
const button = (text: string) => [...dialog().querySelectorAll("button")].find(b => b.textContent?.trim() === text) as HTMLButtonElement;

describe("Share a Trunk as a template", () => {
  it("exports the Trunk and says what the template holds and what was left out", async () => {
    const request = await open();
    expect(request).toHaveBeenCalledWith("trunks.template.export", { agentId: "night" });
    expect(dialog().textContent).toContain("1 skill and 1 routine");
    expect(dialog().textContent).toContain("routines arrive turned off");
    expect(dialog().querySelector('[data-testid="share-warnings"]')?.textContent).toContain('Routine "Ping"');
  });

  it("copies the template link", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await open();
    await act(async () => { button("Copy link").click(); });
    expect(writeText).toHaveBeenCalledWith("branch-template:1:abc");
  });

  it("saves the template file under the name the engine imports", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("night-shift.branch.trunk-template.json"); });
    await open();
    await act(async () => { button("Save template file").click(); });
    expect(clicked).toHaveBeenCalledTimes(1);
    const blob = created.mock.calls[0]?.[0] as Blob;
    expect(JSON.parse(await blob.text())).toEqual(TEMPLATE);
  });

  it("shows the engine's refusal and keeps both actions off", async () => {
    await open(new Error("Persona text looks like it contains a secret (a token or key)."));
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("looks like it contains a secret");
    expect(button("Copy link").disabled).toBe(true);
    expect(button("Save template file").disabled).toBe(true);
  });
});

describe("templateFileName", () => {
  it("makes a file name with the template suffix", () => {
    expect(templateFileName("Night Shift!")).toBe("night-shift.branch.trunk-template.json");
    expect(templateFileName("???")).toBe("trunk.branch.trunk-template.json");
  });
});
