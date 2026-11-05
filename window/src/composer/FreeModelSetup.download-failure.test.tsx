// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import { FreeModelSetup } from "./FreeModelSetup";
import { FREE_MODEL_FAILED } from "./no-key-default";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The engine's managed llama.cpp setup wraps every download error in this sentence (extensions/llama-cpp/src/setup.ts).
const MANAGED =
  "Managed llama.cpp setup failed. Run branch doctor, fix the reported runtime or model issue, then retry. ";
const ASK = {
  done: false,
  step: {
    id: "ask",
    type: "confirm",
    message: "Download Example Model 9B (5.7 GB)?",
    freeModel: { kind: "model", modelName: "Example Model 9B", downloadBytes: 5_700_000_000 },
  },
};

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  );
const settle = async () => {
  for (let i = 0; i < 8; i++)
    await act(async () => {
      await Promise.resolve();
    });
};

/** Say Yes to the download, then the engine's wizard ends with this error. */
async function failDownload(error: string) {
  const queue: unknown[] = [ASK, { done: true, status: "error", error }];
  const request = vi.fn(async (method: string) =>
    method === "wizard.next" ? (queue.shift() ?? { done: true, status: "done" }) : {},
  );
  const engine = { request, agentId: "main" } as unknown as WindowEngine;
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<FreeModelSetup engine={engine} />));
  await settle();
  await act(async () => button("Yes")?.click());
  await settle();
  return document.querySelector<HTMLElement>("[data-testid=no-key-failed]")?.textContent ?? "";
}

describe("FreeModelSetup download failure", () => {
  it.each([
    ["fetch failed", "Branch couldn’t reach the server. Check your internet."],
    [
      "getaddrinfo ENOTFOUND huggingface.co",
      "Branch couldn’t reach the server. Check your internet.",
    ],
    ["ENOSPC: no space left on device, write", "this computer is out of disk space."],
    [
      "download failed: HTTP 503 Service Unavailable",
      "the download server had a problem. Try again later.",
    ],
    ["download failed: HTTP 404 Not Found", "the download server doesn’t have the file right now."],
    ["download failed: HTTP 403 Forbidden", "the download server turned the request down."],
    [
      "download SHA-256 mismatch: expected abc, got def",
      "the file didn’t check out, so Branch didn’t use it.",
    ],
    ["The operation was aborted due to timeout", "it took too long and stopped."],
    [
      "EACCES: permission denied, open '/models/x.gguf.part'",
      "Branch couldn’t save the file on this computer.",
    ],
  ])("says why next to Try again and Cancel: %s", async (detail, reason) => {
    const shown = await failDownload(MANAGED + detail);
    expect(shown).toBe("Download failed: " + reason);
    expect(shown).not.toContain("\n");
    expect(shown).not.toMatch(/HTTP|llama|doctor|ENO|EACCES|huggingface|gguf|mismatch/i);
    expect(button("Try again")).toBeTruthy();
    expect(button("Cancel")).toBeTruthy();
  });

  it("says the setup stopped when the engine's reason is not a known download failure", async () => {
    const shown = await failDownload(MANAGED + "llama-server exited with code 1");
    expect(shown).toBe("Free model setup stopped before it finished.");
    expect(shown).not.toBe(FREE_MODEL_FAILED);
  });

  it("keeps the generic line for an error that is not a setup failure", async () => {
    expect(await failDownload("Unknown llama.cpp runtime for fixture-device: CUDA")).toBe(
      FREE_MODEL_FAILED,
    );
  });

  it.each([
    "network error while loading the wizard",
    "wizard step timed out",
    "fetch failed",
    "gateway request failed: HTTP 503",
    "EACCES: permission denied, open '/config/branch.json'",
  ])("keeps the generic line for a wizard error outside the managed setup: %s", async (error) => {
    const shown = await failDownload(error);
    expect(shown).toBe(FREE_MODEL_FAILED);
    expect(shown).not.toContain("Download failed:");
  });
});
