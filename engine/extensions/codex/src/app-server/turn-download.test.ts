import { describe, expect, it, vi } from "vitest";
import type { CodexAppServerStartOptions } from "./config.js";
import type { ManagedCodexOnDemand } from "./managed-binary.js";
import { CodexRuntimeUnavailableError } from "./on-demand.js";
import {
  canAskCodexDownload,
  codexDownloadNeededMessage,
  prepareCodexForTurn,
  type CodexTurnDownloadEvent,
} from "./turn-download.js";

const ASK = "Download Codex 0.160.0 (163 MB)?";

function fakeOnDemand(allowed = false) {
  return {
    downloadAllowed: vi.fn(() => allowed),
    askMessage: vi.fn(() => ASK),
    waitForDownloadConsent: vi.fn(async () => undefined),
    ensureLauncher: vi.fn(async () => "/codex"),
    status: vi.fn(async () => ({ bytes: 163_000_000, received: 0 })),
  } as unknown as ManagedCodexOnDemand & {
    waitForDownloadConsent: ReturnType<typeof vi.fn>;
    ensureLauncher: ReturnType<typeof vi.fn>;
  };
}

const startOptions = {} as CodexAppServerStartOptions;

describe("canAskCodexDownload", () => {
  it("asks only in the Branch window", () => {
    expect(canAskCodexDownload({ messageChannel: "webchat", trigger: "user" })).toBe(true);
    expect(canAskCodexDownload({ messageChannel: "WebChat" })).toBe(true);
    expect(canAskCodexDownload({})).toBe(false);
    expect(canAskCodexDownload({ messageChannel: "telegram", trigger: "user" })).toBe(false);
  });

  it("never asks a CLI turn sent through the gateway, though it is on webchat", () => {
    expect(
      canAskCodexDownload({ messageChannel: "webchat", trigger: "user", gatewayClientMode: "cli" }),
    ).toBe(false);
    expect(canAskCodexDownload({ messageChannel: "webchat", gatewayClientMode: " CLI " })).toBe(
      false,
    );
  });

  it("still asks a real window turn", () => {
    expect(
      canAskCodexDownload({
        messageChannel: "webchat",
        trigger: "user",
        gatewayClientMode: "webchat",
      }),
    ).toBe(true);
    expect(canAskCodexDownload({ messageChannel: "webchat", gatewayClientMode: "ui" })).toBe(true);
  });

  it("never asks for unattended runs, even from the window", () => {
    for (const trigger of ["cron", "heartbeat", "memory", "overflow"]) {
      expect(canAskCodexDownload({ messageChannel: "webchat", trigger })).toBe(false);
    }
  });
});

describe("prepareCodexForTurn", () => {
  it("fails at once with what to do when nobody can answer", async () => {
    const onDemand = fakeOnDemand();
    const events: CodexTurnDownloadEvent[] = [];
    const error = await prepareCodexForTurn({
      startOptions,
      signal: new AbortController().signal,
      emit: (event) => void events.push(event),
      onDemand,
      pending: async () => true,
      canAsk: false,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodexRuntimeUnavailableError);
    expect((error as CodexRuntimeUnavailableError).reason).toBe("not-downloaded");
    expect((error as Error).message).toBe(codexDownloadNeededMessage(ASK));
    expect((error as Error).message).toContain(ASK);
    expect(onDemand.waitForDownloadConsent).not.toHaveBeenCalled();
    expect(onDemand.ensureLauncher).not.toHaveBeenCalled();
    expect(events.map((event) => event.data.state)).toEqual(["failed"]);
    expect(events[0]?.data.ask).toBe(ASK);
  });

  it("still asks in the window and downloads after a yes", async () => {
    const onDemand = fakeOnDemand();
    const events: CodexTurnDownloadEvent[] = [];
    await prepareCodexForTurn({
      startOptions,
      signal: new AbortController().signal,
      emit: (event) => void events.push(event),
      onDemand,
      pending: async () => true,
      canAsk: true,
    });
    expect(onDemand.waitForDownloadConsent).toHaveBeenCalledOnce();
    expect(events[0]?.data).toMatchObject({ state: "confirm", ask: ASK });
    expect(events.at(-1)?.data.state).toBe("ready");
  });

  it("downloads without asking again once the owner already said yes", async () => {
    const onDemand = fakeOnDemand(true);
    await prepareCodexForTurn({
      startOptions,
      signal: new AbortController().signal,
      emit: () => undefined,
      onDemand,
      pending: async () => true,
      canAsk: false,
    });
    expect(onDemand.ensureLauncher).toHaveBeenCalledOnce();
  });

  it("does nothing when Codex is already on this computer", async () => {
    const onDemand = fakeOnDemand();
    await prepareCodexForTurn({
      startOptions,
      signal: new AbortController().signal,
      emit: () => undefined,
      onDemand,
      pending: async () => false,
      canAsk: false,
    });
    expect(onDemand.ensureLauncher).not.toHaveBeenCalled();
  });
});
