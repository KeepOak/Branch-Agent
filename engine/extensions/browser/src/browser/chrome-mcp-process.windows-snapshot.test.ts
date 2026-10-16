import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChromeMcpSession } from "./chrome-mcp-contracts.js";
import {
  closeChromeMcpSessionHandle,
  refreshChromeMcpCleanupProcess,
  setChromeMcpProcessCleanupDepsForTest,
} from "./chrome-mcp-process.js";

const runExec = vi.hoisted(() => vi.fn());

vi.mock("branch/plugin-sdk/process-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/process-runtime")>()),
  runExec,
}));

// Windows PowerShell's first CIM query on a loaded CI runner has taken over 10 seconds.
const COLD_POWERSHELL_CIM_MS = 10_001;
const NODE_EXE = "C:\\Program Files\\nodejs\\node.exe";
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

type Row = { pid: number; ppid: number; started: string; path: string };

function windowsCensus(rows: Row[]): string {
  return rows.map((row) => `${row.pid}\t${row.ppid}\t${row.started}\t${row.path}`).join("\r\n");
}

afterEach(() => {
  setChromeMcpProcessCleanupDepsForTest(null);
  runExec.mockReset();
});

describe("Chrome MCP Windows process census", () => {
  it("out-waits a cold PowerShell CIM census and proves the whole tree is gone", async () => {
    const alive: Row[] = [
      { pid: 4242, ppid: 900, started: "2026-10-16T10:00:00.0000000-04:00", path: NODE_EXE },
      { pid: 4243, ppid: 4242, started: "2026-10-16T10:00:01.0000000-04:00", path: CHROME_EXE },
      { pid: 4244, ppid: 4243, started: "2026-10-16T10:00:02.0000000-04:00", path: CHROME_EXE },
    ];
    const timeouts: number[] = [];
    runExec.mockImplementation(
      async (command: string, args: string[], options?: { timeoutMs?: number }) => {
        expect(command).toBe("powershell.exe");
        expect(args.at(-1)).toContain("Get-CimInstance Win32_Process");
        timeouts.push(options?.timeoutMs ?? 0);
        if ((options?.timeoutMs ?? 0) < COLD_POWERSHELL_CIM_MS) {
          throw new Error("Command timed out");
        }
        return { stdout: windowsCensus(alive), stderr: "" };
      },
    );
    const taskkillProcessTree = vi.fn(async (rootPid: number) => {
      const doomed = new Set([rootPid]);
      for (const row of alive) {
        if (doomed.has(row.ppid)) {
          doomed.add(row.pid);
        }
      }
      alive.splice(0, alive.length, ...alive.filter((row) => !doomed.has(row.pid)));
    });
    setChromeMcpProcessCleanupDepsForTest({
      platform: "win32",
      sleep: async () => {},
      taskkillProcessTree,
    });
    const transport: { pid: number | null } = { pid: 4242 };
    const closeTransport = vi.fn(async () => {
      transport.pid = null;
    });
    const session = {
      client: { close: vi.fn() },
      transport,
      closeTransport,
      ready: Promise.resolve(),
      processCleanup: { status: "open" },
    } as unknown as ChromeMcpSession;

    await refreshChromeMcpCleanupProcess(session);

    expect(session.processCleanup).toEqual({
      status: "tracked",
      target: {
        root: { pid: 4242, identity: `win32:2026-10-16T10:00:00.0000000-04:00|${NODE_EXE}` },
        descendants: [
          { pid: 4243, identity: `win32:2026-10-16T10:00:01.0000000-04:00|${CHROME_EXE}` },
          { pid: 4244, identity: `win32:2026-10-16T10:00:02.0000000-04:00|${CHROME_EXE}` },
        ],
      },
    });

    await closeChromeMcpSessionHandle(session);

    expect(taskkillProcessTree.mock.calls).toEqual([[4242]]);
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(alive).toEqual([]);
    expect(session.processCleanup).toEqual({ status: "closed" });
    // Start capture, close capture, pre-kill census and the final absence proof.
    expect(timeouts.length).toBeGreaterThanOrEqual(4);
  });
});
