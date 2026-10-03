import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import type { GatewayEventLoopHealth } from "../gateway/server/event-loop-health.js";

const noteMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const { mockNodeChildProcessSpawnSync } = await import("branch/plugin-sdk/test-node-mocks");
  return mockNodeChildProcessSpawnSync(spawnSyncMock, () =>
    vi.importActual<typeof import("node:child_process")>("node:child_process"),
  );
});

vi.mock("../../packages/terminal-core/src/note.js", () => ({ note: noteMock }));

const { collectWhatsappResponsivenessHealthFindings, noteWhatsappResponsivenessHealth } =
  await import("./doctor-whatsapp-responsiveness.js");

const cfg: BranchConfig = { channels: { whatsapp: { enabled: true } } };
const cpuPressure: GatewayEventLoopHealth = {
  degraded: true,
  degradedSinceMs: 0,
  reasons: ["cpu"],
  intervalMs: 1_000,
  delayP99Ms: 40,
  delayMaxMs: 40,
  utilization: 0.04,
  cpuCoreRatio: 2,
};
const localTuis = () => [{ pid: 101, command: "branch-tui --profile another-profile" }];

describe("doctor WhatsApp responsiveness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects local TUI commands through the advisory finding", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: [
        " 101 branch-tui",
        " 102 /usr/bin/node /usr/lib/node_modules/branch/dist/index.js gateway --port 18789",
        " 103 branch channels",
        " 104 branch tui --local",
        " 105 /usr/bin/branch chat",
        " 106 helper --note 'branch tui'",
        " 107 branch-helper branch terminal",
        " 108 branch --flag tui",
      ].join("\n"),
    });
    const findings = collectWhatsappResponsivenessHealthFindings({
      cfg,
      status: { eventLoop: cpuPressure },
    });

    if (process.platform === "win32") {
      expect(findings).toEqual([]);
      expect(spawnSyncMock).not.toHaveBeenCalled();
    } else {
      expect(findings).toEqual([expect.objectContaining({ target: "101, 104, 105" })]);
      expect(spawnSyncMock).toHaveBeenCalledWith("ps", ["-axo", "pid=,command="], {
        encoding: "utf8",
        killSignal: "SIGKILL",
        timeout: 1_000,
      });
    }
  });

  it("keeps pressure advice factual and shared with the note", () => {
    const params = { cfg, status: { eventLoop: cpuPressure }, listLocalTuiProcesses: localTuis };
    const findings = collectWhatsappResponsivenessHealthFindings(params);
    expect(findings).toEqual([
      expect.objectContaining({
        checkId: "core/doctor/whatsapp-responsiveness",
        severity: "warning",
        path: "channels.whatsapp",
        target: "101",
        requirement: "local-tui-event-loop-pressure",
        message:
          "Gateway reports pressure, and local TUI clients were detected. This snapshot does not identify the source of the pressure.",
        fixHint:
          "Inspect Gateway diagnostics with branch gateway diagnostics export before deciding whether to close clients.",
      }),
    ]);
    noteWhatsappResponsivenessHealth(params);
    expect(noteMock).toHaveBeenCalledWith(
      [findings[0]?.message, "Local TUI pids: 101", findings[0]?.fixHint].join("\n"),
      "WhatsApp responsiveness",
    );
  });

  it.each([
    { name: "missing status during maintenance", cfg, status: undefined, tuis: localTuis },
    {
      name: "healthy Gateway",
      cfg,
      status: { eventLoop: { ...cpuPressure, degraded: false, reasons: [] } },
      tuis: localTuis,
    },
    {
      name: "WhatsApp disabled",
      cfg: { channels: { whatsapp: { enabled: false } } },
      status: { eventLoop: cpuPressure },
      tuis: localTuis,
    },
    { name: "no local TUI", cfg, status: { eventLoop: cpuPressure }, tuis: () => [] },
  ])("stays quiet with $name", ({ cfg: caseConfig, status, tuis }) => {
    const params = { cfg: caseConfig, status, listLocalTuiProcesses: tuis };
    expect(collectWhatsappResponsivenessHealthFindings(params)).toEqual([]);
    noteWhatsappResponsivenessHealth(params);
    expect(noteMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});
