import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as boundaryPath from "../infra/boundary-path.js";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";
import {
  resolveBranchAgentDatabaseStoredPath,
  resolveBranchRegisteredAgentDatabasePath,
} from "./branch-state-db.paths.js";

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual, default: actual.win32 };
});

beforeEach(() => {
  mockProcessPlatform("win32");
  // These locators are synthetic; canonical-root cases supply their own observed root.
  vi.spyOn(boundaryPath, "resolveIdentityPathViaExistingAncestorSync").mockImplementation(
    (root) => root,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("Windows agent database inventory paths", () => {
  it.each([String.raw`C:\Branch Agent`, String.raw`\\Server\Share\Branch Agent`])(
    "uses one relative registration across namespace spellings under %s",
    (stateDir) => {
      const relative = String.raw`agents\main\agent\branch-agent.sqlite`;
      const registry = path.join(stateDir, "state", "branch.sqlite");
      const agent = path.join(stateDir, relative);
      for (const registryPath of [registry, path.toNamespacedPath(registry)]) {
        for (const agentPath of [agent, path.toNamespacedPath(agent)]) {
          expect(resolveBranchAgentDatabaseStoredPath(registryPath, agentPath)).toBe(relative);
        }
      }
    },
  );

  it.each([
    [String.raw`C:\Branch Agent`, String.raw`C:\External\branch-agent.sqlite`],
    [String.raw`C:\Branch Agent`, String.raw`D:\External\branch-agent.sqlite`],
    [String.raw`\\Server\Share\Branch Agent`, String.raw`\\Server\Other\branch-agent.sqlite`],
  ])("preserves an external native locator outside %s", (stateDir, external) => {
    const registry = path.join(stateDir, "state", "branch.sqlite");
    const namespaced = path.toNamespacedPath(external);
    expect(resolveBranchAgentDatabaseStoredPath(registry, namespaced)).toBe(namespaced);
  });

  it.each([
    {
      stateDir: String.raw`\\kost\share\Branch Agent`,
      canonicalRoot: String.raw`\\kost\share\Branch Agent`,
      agentPath: String.raw`\\Kost\share\Branch\agents\main\agent.sqlite`,
    },
    {
      stateDir: String.raw`\\server\share\Branch Agent`,
      canonicalRoot: String.raw`\\server\share\Branch Agent`,
      agentPath: String.raw`\\?\UNC\server\share\..\..\server\share\Branch\agent.sqlite`,
    },
    {
      stateDir: String.raw`C:\Branch Agent`,
      canonicalRoot: String.raw`C:\Branch Agent`,
      agentPath: String.raw`\\.\C:\..\UNC\server\share\agent.sqlite`,
    },
    {
      stateDir: String.raw`C:\Alias`,
      canonicalRoot: String.raw`\\kost\share\Branch Agent`,
      agentPath: String.raw`\\Kost\share\Branch\agents\main\agent.sqlite`,
    },
    {
      stateDir: String.raw`C:\Alias`,
      canonicalRoot: String.raw`\\server\share\Branch Agent`,
      agentPath: String.raw`\\?\UNC\server\share\..\..\server\share\Branch\agent.sqlite`,
    },
  ])(
    "retains raw locator identity for $agentPath under $stateDir",
    ({ stateDir, canonicalRoot, agentPath }) => {
      vi.spyOn(boundaryPath, "resolveIdentityPathViaExistingAncestorSync").mockImplementation(
        (root) => {
          expect(root, "only the trusted state root may be probed").toBe(stateDir);
          return canonicalRoot;
        },
      );
      const registry = path.join(stateDir, "state", "branch.sqlite");
      const stored = resolveBranchAgentDatabaseStoredPath(registry, agentPath);
      expect(stored).toBe(agentPath);
      expect(resolveBranchRegisteredAgentDatabasePath(registry, stored)).toBe(agentPath);
    },
  );

  it.each([
    { canonicalRoot: String.raw`D:\Canonical`, relative: String.raw`agents\main\agent.sqlite` },
    {
      canonicalRoot: String.raw`\\server\share\Canonical`,
      relative: String.raw`agents\main\agent.sqlite`,
    },
    { canonicalRoot: String.raw`D:\Canonical`, relative: String.raw`linked\..\agent.sqlite` },
  ])(
    "relativizes an admitted $relative under canonical root $canonicalRoot",
    ({ canonicalRoot, relative }) => {
      const registry = String.raw`C:\Alias\state\branch.sqlite`;
      const resolveRoot = vi.spyOn(boundaryPath, "resolveIdentityPathViaExistingAncestorSync");
      for (const root of [canonicalRoot, path.toNamespacedPath(canonicalRoot)]) {
        resolveRoot.mockReturnValue(root);
        for (const sourceRoot of [canonicalRoot, path.toNamespacedPath(canonicalRoot)]) {
          const candidate = `${sourceRoot}\\${relative}`;
          expect(resolveBranchAgentDatabaseStoredPath(registry, candidate)).toBe(relative);
        }
      }
    },
  );

  it("preserves a raw in-root suffix instead of collapsing link traversal", () => {
    const stateDir = String.raw`C:\Branch Agent`;
    const registry = path.join(stateDir, "state", "branch.sqlite");
    const suffix = String.raw`linked\..\branch-agent.sqlite`;
    expect(resolveBranchAgentDatabaseStoredPath(registry, `${stateDir}\\${suffix}`)).toBe(suffix);
    expect(resolveBranchAgentDatabaseStoredPath(registry, `\\\\?\\${stateDir}\\${suffix}`)).toBe(
      suffix,
    );
  });

  it("preserves a device namespace without a plain drive/share spelling", () => {
    const registry = String.raw`C:\Branch\state\branch.sqlite`;
    const device = String.raw`\\?\Volume{00000000-0000-0000-0000-000000000001}\agent.sqlite`;
    expect(resolveBranchAgentDatabaseStoredPath(registry, device)).toBe(device);
  });
});
