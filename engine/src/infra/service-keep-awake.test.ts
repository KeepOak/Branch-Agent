// Always on: the engine service holds the sleep blocker while a run is active, releases it when idle,
// refreshes power-state so battery backoff still works after the app quits, and does not hold a second
// blocker while the desktop app is open. Spawn and the power answer are fakes.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunKeepAwake, type BlockerProcess } from "./keep-awake.js";
import { POWER_STATE_FILE, readOnBattery, startBatteryPoliteness } from "./power-state.js";
import {
  createServiceKeepAwake,
  DESKTOP_KEEP_AWAKE_FRESH_MS,
  KEEP_AWAKE_OWNER_FILE,
  readPlatformOnBatterySync,
  resolveServiceKeepAwakePaths,
  serviceRunIsActive,
  type ServiceKeepAwake,
} from "./service-keep-awake.js";

interface Started {
  file: string;
  args: string[];
  options: { stdio: string; windowsHide: boolean; detached: boolean };
  killed: boolean;
  child: EventEmitter & { kill: () => boolean };
}

function fakeSpawn() {
  const started: Started[] = [];
  const spawn: (
    file: string,
    args: string[],
    options: { stdio: "ignore"; windowsHide: true; detached: false },
  ) => BlockerProcess = (file, args, options) => {
    const child = new EventEmitter() as Started["child"];
    const entry: Started = { file, args, options, killed: false, child };
    child.kill = () => {
      entry.killed = true;
      child.emit("exit");
      return true;
    };
    started.push(entry);
    return child;
  };
  return { spawn, started, held: () => started.filter((entry) => !entry.killed) };
}

describe("service keep awake", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-service-awake-"));
    dirs.push(dir);
    return dir;
  };

  function owner(
    stateDir: string,
    body: { sleep: string; power: string; at: number },
  ): void {
    fs.writeFileSync(path.join(stateDir, KEEP_AWAKE_OWNER_FILE), JSON.stringify(body));
  }

  function fixture(over: {
    stateDir?: string;
    settingsFile?: string;
    now?: () => number;
    runsActive?: () => boolean;
    onBattery?: () => boolean;
    platform?: NodeJS.Platform;
  } = {}): { engine: ServiceKeepAwake; fake: ReturnType<typeof fakeSpawn>; stateDir: string } {
    const stateDir = over.stateDir ?? tempDir();
    const fake = fakeSpawn();
    const engine = createServiceKeepAwake({
      stateDir,
      settingsFile: over.settingsFile ?? path.join(stateDir, "desktop-settings.json"),
      platform: over.platform ?? "darwin",
      pid: 7,
      now: over.now ?? (() => 1_000_000),
      runsActive: over.runsActive ?? (() => false),
      onBattery: over.onBattery ?? (() => false),
      spawn: fake.spawn,
      log: () => {},
    });
    return { engine, fake, stateDir };
  }

  it("holds the sleep blocker while a run is active and releases it when idle", () => {
    let runs = 0;
    const { engine, fake } = fixture({ runsActive: () => runs > 0 });
    engine.tick();
    expect(fake.started).toHaveLength(0);
    runs = 1;
    engine.tick();
    engine.tick();
    expect(fake.held()).toHaveLength(1);
    expect(engine.held()).toBe(true);
    expect(fake.started[0]?.file).toBe("caffeinate");
    expect(fake.started[0]?.args).toEqual(["-i", "-w", "7"]);
    expect(fake.started[0]?.options).toEqual({ stdio: "ignore", windowsHide: true, detached: false });
    runs = 0;
    engine.tick();
    expect(fake.held()).toHaveLength(0);
    expect(engine.held()).toBe(false);
    expect(serviceRunIsActive({ embeddedRuns: 1, agentRuns: 0, chatRuns: 0, acpRuns: 0, totalActive: 1 })).toBe(
      true,
    );
    expect(serviceRunIsActive({ embeddedRuns: 0, agentRuns: 0, chatRuns: 0, acpRuns: 0, totalActive: 0 })).toBe(
      false,
    );
  });

  it("refreshes power state so battery backoff still applies after the app's file would have gone stale", () => {
    const now = { t: 1_000_000 };
    const { engine, fake, stateDir } = fixture({
      now: () => now.t,
      runsActive: () => true,
      onBattery: () => true,
    });
    fs.writeFileSync(
      path.join(stateDir, POWER_STATE_FILE),
      JSON.stringify({ onBattery: true, at: now.t - 31 * 60_000 }),
    );
    expect(readOnBattery(stateDir, now.t)).toBe(false);
    engine.tick();
    expect(engine.held()).toBe(false);
    expect(fake.started).toHaveLength(0);
    expect(readOnBattery(stateDir, now.t)).toBe(true);
    const priorities: number[] = [];
    const battery = startBatteryPoliteness({
      stateDir,
      now: () => now.t,
      setPriority: (priority) => priorities.push(priority),
      pollMs: 60_000,
    });
    try {
      expect(battery.onBattery()).toBe(true);
      expect(battery.backoffMs(60_000)).toBe(180_000);
      expect(priorities).toEqual([os.constants.priority.PRIORITY_BELOW_NORMAL]);
    } finally {
      battery.stop();
    }
    now.t += 60 * 60_000;
    expect(readOnBattery(stateDir, now.t)).toBe(false);
    engine.tick();
    expect(readOnBattery(stateDir, now.t)).toBe(true);
    fs.writeFileSync(
      path.join(stateDir, "desktop-settings.json"),
      JSON.stringify({ keepAwake: true, keepAwakeOnBattery: true }),
    );
    engine.tick();
    expect(engine.held()).toBe(true);
    expect(fake.held()).toHaveLength(1);
  });

  it("does not double hold while the desktop app is open", () => {
    const now = 5_000_000;
    const { engine, fake, stateDir } = fixture({
      now: () => now,
      runsActive: () => true,
      onBattery: () => false,
    });
    const desktopSpawn = fakeSpawn();
    const desktop = createRunKeepAwake({
      platform: "darwin",
      appPid: 8,
      spawn: desktopSpawn.spawn,
      enabled: () => true,
      onBatteryToo: () => false,
      onBattery: () => false,
      log: () => {},
    });
    // The open app owns the power file and leaves sleep to the engine, and does not hold its own blocker.
    owner(stateDir, { sleep: "engine", power: "desktop", at: now });
    desktop.update(false);
    engine.tick();
    expect(engine.held()).toBe(true);
    expect(desktop.held()).toBe(false);
    expect(fake.held()).toHaveLength(1);
    expect(desktopSpawn.held()).toHaveLength(0);
    expect(fs.existsSync(path.join(stateDir, POWER_STATE_FILE))).toBe(false);

    // An app that is itself holding the blocker: the engine stands down, so there is still one hold.
    owner(stateDir, { sleep: "desktop", power: "desktop", at: now });
    desktop.update(true);
    engine.tick();
    expect(engine.held()).toBe(false);
    expect(desktop.held()).toBe(true);
    expect(fake.held()).toHaveLength(0);
    expect(desktopSpawn.held()).toHaveLength(1);

    // Quit hands both duties to the engine. The app releases first; the engine holds the one blocker.
    desktop.dispose();
    owner(stateDir, { sleep: "engine", power: "engine", at: now });
    engine.tick();
    expect(desktop.held()).toBe(false);
    expect(engine.held()).toBe(true);
    expect(fake.held()).toHaveLength(1);
    expect(desktopSpawn.held()).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, POWER_STATE_FILE), "utf8"))).toEqual({
      onBattery: false,
      at: now,
    });

    // A stale "desktop is holding" file does not keep the engine from taking over.
    owner(stateDir, { sleep: "desktop", power: "desktop", at: now - DESKTOP_KEEP_AWAKE_FRESH_MS });
    engine.tick();
    expect(engine.held()).toBe(true);
  });

  it("stays off for a child engine and for a service that is not the desktop app", () => {
    const data = tempDir();
    const home = path.join(data, "home");
    const env = {
      BRANCH_HOME: home,
      BRANCH_STATE_DIR: path.join(home, ".branch"),
    };
    expect(resolveServiceKeepAwakePaths(env)).toBeUndefined();
    expect(
      resolveServiceKeepAwakePaths({
        ...env,
        BRANCH_SERVICE_MARKER: "branch",
        BRANCH_SERVICE_KIND: "gateway",
      }),
    ).toBeUndefined();
    fs.writeFileSync(path.join(data, "gateway-token"), "token");
    expect(
      resolveServiceKeepAwakePaths({
        ...env,
        BRANCH_SERVICE_MARKER: "branch",
        BRANCH_SERVICE_KIND: "gateway",
      }),
    ).toEqual({
      stateDir: path.join(home, ".branch"),
      settingsFile: path.join(data, "desktop-settings.json"),
    });
    expect(
      resolveServiceKeepAwakePaths({
        ...env,
        BRANCH_SERVICE_MARKER: "branch",
        BRANCH_SERVICE_KIND: "node",
      }, () => true),
    ).toBeUndefined();
  });

  it("reads battery from the platform power source and treats a failure as plugged in", () => {
    const sys = (online: string, status: string) =>
      readPlatformOnBatterySync("linux", {
        readdir: () => ["AC", "BAT0"],
        readFile: (file) => {
          const found: Record<string, string> = {
            "/sys/class/power_supply/AC/type": "Mains",
            "/sys/class/power_supply/AC/online": online,
            "/sys/class/power_supply/BAT0/type": "Battery",
            "/sys/class/power_supply/BAT0/status": status,
          };
          const text = found[file];
          if (text === undefined) {
            throw new Error("missing");
          }
          return text;
        },
      });
    expect(sys("0", "Discharging")).toBe(true);
    expect(sys("1", "Discharging")).toBe(false);
    expect(
      readPlatformOnBatterySync("darwin", {
        execFile: () => "Now drawing from 'Battery Power'\n -InternalBattery-0 80%; discharging",
      }),
    ).toBe(true);
    expect(
      readPlatformOnBatterySync("darwin", {
        execFile: () => "Now drawing from 'AC Power'\n -InternalBattery-0 100%; charged",
      }),
    ).toBe(false);
    expect(readPlatformOnBatterySync("win32", { execFile: () => "0\r\n" })).toBe(true);
    expect(readPlatformOnBatterySync("win32", { execFile: () => "1\r\n" })).toBe(false);
    expect(readPlatformOnBatterySync("linux", { readdir: () => { throw new Error("no sysfs"); } })).toBe(false);
    expect(readPlatformOnBatterySync("freebsd", {})).toBe(false);
  });
});
