// Gateway run command option registration and lazy handoff to runtime startup.
import { Option, type Command } from "commander";
import {
  WINDOWS_TASK_SUPERVISOR_CHILD_FLAG,
  WINDOWS_TASK_SUPERVISOR_FLAG,
} from "../../daemon/windows-task-supervisor-contract.js";
import type { GatewayRunOpts } from "./run-options.js";
import { resolveGatewayRunOptions } from "./run-options.js";
import { getGatewayRunRuntimeHooks } from "./runtime-hooks.js";

type GatewayRunCommandHooks = {
  beforeRun?: (opts: Pick<GatewayRunOpts, "force" | "reset">) => Promise<void> | void;
};

export function addGatewayRunCommand(cmd: Command, hooks: GatewayRunCommandHooks = {}): Command {
  return cmd
    .option("--port <port>", "Port for the gateway WebSocket")
    .option(
      "--bind <mode>",
      'Bind mode ("loopback"|"lan"|"tailnet"|"auto"|"custom"). Defaults to config gateway.bind (or loopback).',
    )
    .option(
      "--token <token>",
      "Shared token required in connect.params.auth.token (default: BRANCH_GATEWAY_TOKEN env if set)",
    )
    .option("--auth <mode>", 'Gateway auth mode ("none"|"token"|"password"|"trusted-proxy")')
    .option("--password <password>", "Password for auth mode=password")
    .option("--password-file <path>", "Read gateway password from file")
    .option("--tailscale <mode>", 'Tailscale exposure mode ("off"|"serve"|"funnel")')
    .addOption(new Option("--tailscale-reset-on-exit").hideHelp())
    .option(
      "--allow-unconfigured",
      "Allow gateway start without enforcing gateway.mode=local in config (does not repair config)",
      false,
    )
    .option("--dev", "Create a dev config + workspace if missing (no BOOTSTRAP.md)", false)
    .option(
      "--ambient-channels",
      "Allow the gateway to auto-configure channels from ambient environment variables",
      false,
    )
    .option("--dev-ambient-channels", "Deprecated alias for --ambient-channels", false)
    .option(
      "--reset",
      "Reset dev config + credentials + sessions + workspace (requires --dev)",
      false,
    )
    .addOption(new Option(WINDOWS_TASK_SUPERVISOR_FLAG).hideHelp())
    .addOption(new Option(`${WINDOWS_TASK_SUPERVISOR_CHILD_FLAG} <restart-code>`).hideHelp())
    .addOption(new Option("--update-canary").hideHelp())
    .option("--force", "Kill any existing listener on the target port before starting", false)
    .option("--replace", "Replace a live host gateway that serves this profile", false)
    .option("--verbose", "Verbose logging to stdout/stderr", false)
    .option(
      "--cli-backend-logs",
      "Only show CLI backend logs in the console (includes stdout/stderr)",
      false,
    )
    .option("--claude-cli-logs", "Deprecated alias for --cli-backend-logs", false)
    .option("--ws-log <style>", 'WebSocket log style ("auto"|"full"|"compact")', "auto")
    .option("--compact", 'Alias for "--ws-log compact"', false)
    .option("--raw-stream", "Log raw model stream events to jsonl", false)
    .option("--raw-stream-path <path>", "Raw stream jsonl path")
    .action(async (opts, command) => {
      const resolved = resolveGatewayRunOptions(opts, command);
      // Resolve the host before CLI bootstrap tries to migrate state. A second
      // launch otherwise fails the state-owner guard before it can attach.
      // A desktop's prepared standby is that second launch on purpose: it claims
      // the host only once it takes over (run.ts), when its predecessor has
      // handed the host role over with the state.
      const host =
        resolved.taskSupervisor || resolved.reset || process.env.BRANCH_GATEWAY_STANDBY === "1"
          ? undefined
          : await (
              await import("../../infra/host-rendezvous.js")
            ).prepareHostRendezvous({
              profile: process.env.BRANCH_PROFILE?.trim() || "default",
              home: process.env.BRANCH_HOME?.trim() || (await import("node:os")).homedir(),
              gatewayPort: 0,
              force: resolved.force,
              replace: resolved.replace,
            });
      if (host && host.decision.outcome !== "start") {
        const { defaultRuntime } = await import("../../runtime.js");
        if (host.decision.outcome === "attach") {
          defaultRuntime.log(host.decision.message);
        } else {
          defaultRuntime.error(host.decision.message);
          defaultRuntime.exit(host.decision.transient ? 75 : 78);
        }
        return;
      }
      const { withAgentDatabaseStartupAdmission } =
        await import("../../state/agent-database-startup.js");
      try {
        return await withAgentDatabaseStartupAdmission(
          async () => {
            try {
              await hooks.beforeRun?.(resolved);
              const { runGatewayCommand } = await import("./run.js");
              if (host?.close) {
                await runGatewayCommand(resolved, getGatewayRunRuntimeHooks(), undefined, host);
              } else {
                await runGatewayCommand(resolved, getGatewayRunRuntimeHooks());
              }
            } catch (error) {
              const { handleGatewayStartupMaintenance } = await import("./startup-maintenance.js");
              if (!(await handleGatewayStartupMaintenance(error))) {
                throw error;
              }
            }
          },
          { deferInspections: !resolved.updateCanary },
        );
      } finally {
        await host?.close?.();
      }
    });
}
