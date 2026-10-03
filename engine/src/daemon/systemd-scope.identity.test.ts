import fs from "node:fs/promises";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findInstalledSystemdGatewayScope, isNonFatalSystemdInstallProbeError } from "./systemd.js";

const findSystemGatewayServicesMock = vi.hoisted(() =>
  vi.fn<typeof import("./inspect.js").findSystemGatewayServices>(async () => []),
);

vi.mock("./inspect.js", () => ({
  findSystemGatewayServices: () => findSystemGatewayServicesMock(),
}));

const TEST_MANAGED_HOME = "/tmp/branch-test-home";

function pathLikeToString(pathname: unknown): string {
  if (typeof pathname === "string") {
    return pathname;
  }
  if (pathname instanceof URL) {
    return pathname.pathname;
  }
  if (pathname instanceof Uint8Array) {
    return Buffer.from(pathname).toString("utf8");
  }
  return "";
}

function mockUnitFileLayout(layout: {
  user?: boolean | string | string[];
  system?: string | false;
}) {
  vi.spyOn(fs, "access").mockImplementation(async (pathArg) => {
    const p = pathLikeToString(pathArg);
    const userOk = (() => {
      if (!layout.user) {
        return false;
      }
      if (layout.user === true) {
        return p.includes("/.config/systemd/user/");
      }
      const names = Array.isArray(layout.user) ? layout.user : [layout.user];
      return names.some((name) => p.includes("/.config/systemd/user/") && p.endsWith(`/${name}`));
    })();
    if (userOk) {
      return undefined;
    }
    if (typeof layout.system === "string" && p === layout.system) {
      return undefined;
    }
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  });
}

describe("systemd gateway identity (openclaw#119648)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    findSystemGatewayServicesMock.mockReset().mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("findInstalledSystemdGatewayScope falls back to marker-owned system unit with custom name", async () => {
    mockUnitFileLayout({ system: false });
    findSystemGatewayServicesMock.mockResolvedValueOnce([
      {
        platform: "linux",
        label: "branch.service",
        detail: "unit: /etc/systemd/system/branch.service",
        sourcePath: "/etc/systemd/system/branch.service",
        scope: "system",
        marker: "branch",
      },
    ]);
    const result = await findInstalledSystemdGatewayScope({ HOME: TEST_MANAGED_HOME });
    expect(result).toEqual({
      scope: "system",
      unitName: "branch.service",
      unitPath: "/etc/systemd/system/branch.service",
    });
  });

  it("findInstalledSystemdGatewayScope refuses marker-owned units from another profile", async () => {
    mockUnitFileLayout({ system: false });
    findSystemGatewayServicesMock.mockResolvedValueOnce([
      {
        platform: "linux",
        label: "branch-darlene.service",
        detail: "unit: /etc/systemd/system/branch-darlene.service",
        sourcePath: "/etc/systemd/system/branch-darlene.service",
        scope: "system",
        marker: "branch",
      },
    ]);
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_PROFILE: "lisa",
    });
    expect(result).toBeNull();
  });

  it("keeps Linux profile unit names case-sensitive", async () => {
    mockUnitFileLayout({ system: false });
    findSystemGatewayServicesMock.mockResolvedValueOnce([
      {
        platform: "linux",
        label: "branch-gateway-lisa.service",
        detail: "unit: /etc/systemd/system/branch-gateway-lisa.service",
        sourcePath: "/etc/systemd/system/branch-gateway-lisa.service",
        scope: "system",
        marker: "branch",
      },
    ]);
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_PROFILE: "Lisa",
    });
    expect(result).toBeNull();
  });

  it("does not let an isolated home adopt a custom system unit", async () => {
    mockUnitFileLayout({ system: false });
    findSystemGatewayServicesMock.mockResolvedValueOnce([
      {
        platform: "linux",
        label: "my-custom-gateway.service",
        detail: "unit: /etc/systemd/system/my-custom-gateway.service",
        sourcePath: "/etc/systemd/system/my-custom-gateway.service",
        scope: "system",
        marker: "branch",
      },
    ]);
    const result = await findInstalledSystemdGatewayScope({ HOME: TEST_MANAGED_HOME });
    expect(result).toBeNull();
  });

  it("findInstalledSystemdGatewayScope accepts legacy branch-<profile> system unit", async () => {
    mockUnitFileLayout({ system: "/etc/systemd/system/branch-lisa.service" });
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_PROFILE: "lisa",
    });
    expect(result).toEqual({
      scope: "system",
      unitName: "branch-lisa.service",
      unitPath: "/etc/systemd/system/branch-lisa.service",
    });
  });

  it("does not adopt Node or another profile's canonical unit as this profile's legacy name", async () => {
    mockUnitFileLayout({
      user: ["branch-node.service", "branch-gateway.service", "branch-gateway-lisa.service"],
    });
    await expect(
      findInstalledSystemdGatewayScope({
        HOME: TEST_MANAGED_HOME,
        BRANCH_PROFILE: "node",
      }),
    ).resolves.toBeNull();
    await expect(
      findInstalledSystemdGatewayScope({
        HOME: TEST_MANAGED_HOME,
        BRANCH_PROFILE: "gateway",
      }),
    ).resolves.toBeNull();
    await expect(
      findInstalledSystemdGatewayScope({
        HOME: TEST_MANAGED_HOME,
        BRANCH_PROFILE: "gateway-lisa",
      }),
    ).resolves.toBeNull();
  });

  it("findInstalledSystemdGatewayScope honors BRANCH_SYSTEMD_UNIT for Node unit", async () => {
    mockUnitFileLayout({ system: "/etc/systemd/system/branch-node.service" });
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_PROFILE: "lisa",
      BRANCH_SYSTEMD_UNIT: "branch-node",
    });
    expect(result).toEqual({
      scope: "system",
      unitName: "branch-node.service",
      unitPath: "/etc/systemd/system/branch-node.service",
    });
  });

  it("findInstalledSystemdGatewayScope honors BRANCH_SYSTEMD_UNIT for custom user unit", async () => {
    mockUnitFileLayout({ user: true, system: false });
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_PROFILE: "lisa",
      BRANCH_SYSTEMD_UNIT: "branch-gateway-lisa",
    });
    expect(result?.scope).toBe("user");
    expect(result?.unitName).toBe("branch-gateway-lisa.service");
    expect(result?.unitPath).toContain("/.config/systemd/user/branch-gateway-lisa.service");
  });

  it.each(["my-gateway@.service", "my-gateway@gateway.service"])(
    "does not expand an explicit plain unit into %s",
    async (label) => {
      mockUnitFileLayout({ system: false });
      findSystemGatewayServicesMock.mockResolvedValueOnce([
        {
          platform: "linux",
          label,
          detail: `unit: /etc/systemd/system/${label}`,
          sourcePath: `/etc/systemd/system/${label}`,
          scope: "system",
          marker: "branch",
        },
      ]);
      await expect(
        findInstalledSystemdGatewayScope({
          HOME: TEST_MANAGED_HOME,
          BRANCH_SYSTEMD_UNIT: "my-gateway",
        }),
      ).resolves.toBeNull();
    },
  );

  it("explicit instance override resolves a template-only system install", async () => {
    mockUnitFileLayout({ system: false });
    vi.spyOn(os, "userInfo").mockReturnValue({
      username: "unrelated-login",
      uid: 1000,
      gid: 1000,
      homedir: TEST_MANAGED_HOME,
      shell: "/bin/sh",
    });
    findSystemGatewayServicesMock.mockResolvedValueOnce([
      {
        platform: "linux",
        label: "branch@.service",
        detail: "unit: /etc/systemd/system/branch@.service",
        sourcePath: "/etc/systemd/system/branch@.service",
        scope: "system",
        marker: "branch",
      },
    ]);
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_SYSTEMD_UNIT: "branch@gateway.service",
    });
    expect(result).toEqual({
      scope: "system",
      unitName: "branch@gateway.service",
      unitPath: "/etc/systemd/system/branch@.service",
    });
  });

  it("explicit instance override does not adopt a different template instance", async () => {
    mockUnitFileLayout({ system: false });
    findSystemGatewayServicesMock.mockResolvedValueOnce([
      {
        platform: "linux",
        label: "branch@other.service",
        detail: "unit: /etc/systemd/system/branch@other.service",
        sourcePath: "/etc/systemd/system/branch@other.service",
        scope: "system",
        marker: "branch",
      },
    ]);
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_SYSTEMD_UNIT: "branch@gateway.service",
    });
    expect(result).toBeNull();
  });

  it("explicit instance override finds the backing template on disk", async () => {
    mockUnitFileLayout({ system: "/etc/systemd/system/branch@.service" });
    vi.spyOn(os, "userInfo").mockReturnValue({
      username: "unrelated-login",
      uid: 1000,
      gid: 1000,
      homedir: TEST_MANAGED_HOME,
      shell: "/bin/sh",
    });
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_SYSTEMD_UNIT: "branch@gateway.service",
    });
    expect(result).toEqual({
      scope: "system",
      unitName: "branch@gateway.service",
      unitPath: "/etc/systemd/system/branch@.service",
    });
  });

  it("explicit BRANCH_SYSTEMD_UNIT does not adopt an unrelated profile unit", async () => {
    mockUnitFileLayout({ system: false });
    findSystemGatewayServicesMock.mockResolvedValueOnce([
      {
        platform: "linux",
        label: "branch-darlene.service",
        detail: "unit: /etc/systemd/system/branch-darlene.service",
        sourcePath: "/etc/systemd/system/branch-darlene.service",
        scope: "system",
        marker: "branch",
      },
    ]);
    const result = await findInstalledSystemdGatewayScope({
      HOME: TEST_MANAGED_HOME,
      BRANCH_SYSTEMD_UNIT: "branch-node",
    });
    expect(result).toBeNull();
  });
});

describe("isNonFatalSystemdInstallProbeError", () => {
  it("matches wrapper-only WSL install probe failures", () => {
    expect(
      isNonFatalSystemdInstallProbeError(
        new Error("Command failed: systemctl --user is-enabled branch-gateway.service"),
      ),
    ).toBe(true);
  });

  it("matches bus-unavailable install probe failures", () => {
    expect(
      isNonFatalSystemdInstallProbeError(
        new Error("systemctl is-enabled unavailable: Failed to connect to bus"),
      ),
    ).toBe(true);
  });

  it("does not match real infrastructure failures", () => {
    expect(
      isNonFatalSystemdInstallProbeError(
        new Error("systemctl is-enabled unavailable: read-only file system"),
      ),
    ).toBe(false);
  });
});
