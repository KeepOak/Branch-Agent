// Written by Branch for INTEGRATIONS-0128 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/gateway/server-methods/nodes.invoke.ts and node-command-rejection-hint.ts; exercises the production policy without replacing Branch's newer authority checks.
import { afterEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { resetPluginRuntimeStateForTest } from "../../plugins/runtime.js";
import {
  DEFAULT_DANGEROUS_NODE_COMMANDS,
  isNodeCommandAllowed,
  resolveNodeCommandAllowlist,
} from "../node-command-policy.js";
import { buildNodeCommandRejectionHint } from "./node-command-rejection-hint.js";

describe("Harvest node command allowlist behavior", () => {
  afterEach(() => resetPluginRuntimeStateForTest());

  const node = { platform: "android", deviceFamily: "Android" };
  const config = (allow: string[], deny: string[] = []): BranchConfig => ({
    gateway: { nodes: { commands: { allow, deny } } },
  });
  const check = (command: string, cfg: BranchConfig, declaredCommands?: string[]) =>
    isNodeCommandAllowed({
      command,
      declaredCommands,
      allowlist: resolveNodeCommandAllowlist(cfg, node),
    });

  it.each(DEFAULT_DANGEROUS_NODE_COMMANDS)(
    "requires explicit opt-in for %s and keeps deny precedence",
    (command) => {
      expect(check(command, {}, [command])).toEqual({
        ok: false,
        reason: "command not allowlisted",
      });
      expect(
        buildNodeCommandRejectionHint("command not allowlisted", command, node, {}),
      ).toBe(
        `node command not allowed: "${command}" requires explicit gateway.nodes.commands.allow opt-in`,
      );
      expect(check(command, config([command]), [command])).toEqual({ ok: true });
      const denied = config([command], [command]);
      expect(check(command, denied, [command])).toEqual({
        ok: false,
        reason: "command not allowlisted",
      });
      expect(
        buildNodeCommandRejectionHint("command not allowlisted", command, node, denied),
      ).toBe(`node command not allowed: "${command}" is blocked by gateway.nodes.commands.deny`);
    },
  );

  it("requires a node declaration even after explicit operator opt-in", () => {
    const cfg = config(["camera.snap"]);
    expect(check("camera.snap", cfg, [])).toEqual({
      ok: false,
      reason: "node did not declare commands",
    });
    expect(check("camera.snap", cfg, ["camera.list"])).toEqual({
      ok: false,
      reason: "command not declared by node",
    });
    expect(
      buildNodeCommandRejectionHint("command not declared by node", "camera.snap", node, cfg),
    ).toBe('node command not allowed: the node (platform: android) does not support "camera.snap"');
  });

  it("allows safe declared mobile commands without an extra operator opt-in", () => {
    for (const command of ["camera.list", "location.get", "device.info", "system.notify"]) {
      expect(check(command, {}, [command])).toEqual({ ok: true });
    }
  });

  it("distinguishes pending declaration approval from an unsupported node", () => {
    expect(
      buildNodeCommandRejectionHint(
        "node did not declare commands",
        "camera.list",
        { ...node, declaredCommands: ["camera.list"] },
        {},
      ),
    ).toBe(
      "node command not allowed: the node's declared command surface is pending approval; run `branch nodes pending`, then `branch nodes approve <requestId>`",
    );
    expect(
      buildNodeCommandRejectionHint("node did not declare commands", "camera.list", node, {}),
    ).toBe("node command not allowed: the node did not declare any supported commands");
  });
});
