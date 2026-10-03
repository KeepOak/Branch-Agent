// Legacy grovebot command namespace kept for QR/linking aliases.
import type { Command } from "commander";
import { formatDocsHelp } from "./help-format.js";
import { registerQrCli } from "./qr-cli.js";

export function registerGrovebotCli(program: Command) {
  const grovebot = program
    .command("grovebot")
    .description("Legacy grovebot command aliases")
    .addHelpText("after", () => formatDocsHelp("/cli/grovebot"));
  registerQrCli(grovebot);
}
