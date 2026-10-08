// Written by Branch for OPS-0005 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/daemon/systemd-unit.ts and src/daemon/systemd-linger.ts; not copied.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSystemdUnit, parseSystemdExecStart } from "./systemd-unit.js";

const native = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("./exec-file.js", () => ({ execFileUtf8: native.exec }));

import { enableSystemdUserLinger, readSystemdUserLingerStatus } from "./systemd-linger.js";

beforeEach(() => {
  native.exec.mockReset();
  native.exec.mockResolvedValue({ stdout: "Linger=yes\n", stderr: "", code: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("systemd service persistence", () => {
  it("keeps the real gateway command and restart policy in the generated login unit", () => {
    const argv = ["/opt/Branch Agent/node", "/opt/Branch Agent/gateway.js", "--port", "18789"];
    const unit = buildSystemdUnit({ programArguments: argv, environment: {} });
    const lines = unit.split("\n");
    const command = lines.find((line) => line.startsWith("ExecStart="));
    expect(command).toBeDefined();
    expect(parseSystemdExecStart(command!.slice("ExecStart=".length))).toEqual(argv);
    expect(lines).toEqual(
      expect.arrayContaining([
        "After=network-online.target",
        "Wants=network-online.target",
        "Restart=always",
        "RestartSec=5",
        "RestartPreventExitStatus=78",
        "StartLimitBurst=10",
        "StartLimitIntervalSec=300",
        "WantedBy=default.target",
      ]),
    );
  });

  it.each(["yes", "no"] as const)(
    "reads the native linger=%s result for the selected user",
    async (linger) => {
      native.exec.mockResolvedValue({
        stdout: `UID=1000\nLinger=${linger}\n`,
        stderr: "",
        code: 0,
      });
      expect(await readSystemdUserLingerStatus({ env: { USER: "branch-owner" } })).toEqual({
        user: "branch-owner",
        linger,
      });
      expect(native.exec).toHaveBeenCalledWith(
        "loginctl",
        ["show-user", "branch-owner", "-p", "Linger"],
        { timeout: 5_000 },
      );
    },
  );

  it.each([
    { stdout: "Linger=unknown\n", code: 0 },
    { stdout: "Linger=yes\n", code: 1 },
  ])("does not claim persistence from an unconfirmed native response %j", async (result) => {
    native.exec.mockResolvedValue({ ...result, stderr: "" });
    expect(await readSystemdUserLingerStatus({ env: {}, user: "selected-owner" })).toBeNull();
    expect(native.exec.mock.calls[0]?.[1]).toEqual(["show-user", "selected-owner", "-p", "Linger"]);
  });

  it("enables linger without an interactive prompt when automation requests it", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(1000);
    native.exec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    expect(
      await enableSystemdUserLinger({ env: { USER: "branch-owner" }, sudoMode: "non-interactive" }),
    ).toEqual({ ok: true, stdout: "", stderr: "", code: 0 });
    expect(native.exec).toHaveBeenCalledWith(
      "sudo",
      ["-n", "loginctl", "enable-linger", "branch-owner"],
      { timeout: 30_000 },
    );
  });

  it("preserves native refusal and runs loginctl directly for root", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(0);
    native.exec.mockResolvedValue({ stdout: "", stderr: "Access denied", code: 1 });
    expect(
      await enableSystemdUserLinger({ env: {}, user: "selected-owner", sudoMode: "prompt" }),
    ).toEqual({ ok: false, stdout: "", stderr: "Access denied", code: 1 });
    expect(native.exec).toHaveBeenCalledWith("loginctl", ["enable-linger", "selected-owner"], {
      timeout: 30_000,
    });
  });
});
