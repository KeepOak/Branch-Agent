// Always on (Private #454 G): "Keep working when nobody is signed in" turns systemd linger on and off through the
// engine's systemd-linger path. loginctl is a fake; nothing here touches a real service.
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileUtf8 = vi.hoisted(() => vi.fn());
vi.mock("./exec-file.js", () => ({ execFileUtf8 }));

describe("keep working when nobody is signed in (linger)", () => {
  afterEach(() => execFileUtf8.mockReset());

  it("turns linger on and off through the daemon's systemd-linger path", async () => {
    const { runGatewayLingerCommand } = await import("../cli/daemon-cli/register-service-commands.js");
    let linger = "no";
    execFileUtf8.mockImplementation(async (command: string, args: string[]) => {
      if (args[0] === "enable-linger") linger = "yes";
      if (args[0] === "disable-linger") linger = "no";
      return { stdout: command === "loginctl" && args[0] === "show-user" ? `Linger=${linger}\n` : "", stderr: "", code: 0 };
    });
    const lines: string[] = [];
    const exit = vi.fn();
    const env = { ...process.env, USER: "pat" };
    const before = process.env;
    process.env = env;
    try {
      await runGatewayLingerCommand("on", true, { platform: "linux", write: (line) => lines.push(line), exit });
      await runGatewayLingerCommand("off", true, { platform: "linux", write: (line) => lines.push(line), exit });
    } finally {
      process.env = before;
    }
    const calls = execFileUtf8.mock.calls.map(([command, args]) => [command, ...(args as string[])].join(" "));
    expect(calls).toEqual([
      "loginctl enable-linger pat",
      "loginctl show-user pat -p Linger",
      "loginctl disable-linger pat",
      "loginctl show-user pat -p Linger",
    ]);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { ok: true, user: "pat", linger: "yes" },
      { ok: true, user: "pat", linger: "no" },
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("gives the one command to run when loginctl wants an admin, and refuses off Linux", async () => {
    const { runGatewayLingerCommand } = await import("../cli/daemon-cli/register-service-commands.js");
    execFileUtf8.mockResolvedValue({ stdout: "", stderr: "Access denied", code: 1 });
    const lines: string[] = [];
    const exit = vi.fn();
    await runGatewayLingerCommand("on", true, { platform: "linux", write: (line) => lines.push(line), exit });
    await runGatewayLingerCommand("on", true, { platform: "darwin", write: (line) => lines.push(line), exit });
    expect(JSON.parse(lines[0]).error).toMatch(/Access denied.*sudo loginctl enable-linger/);
    expect(JSON.parse(lines[1]).error).toMatch(/Linux only/);
    expect(exit).toHaveBeenCalledTimes(2);
  });
});
