// Validates config after an approved Branch Agent write and asks for one repair.
import { isSystemAgentInferenceUnavailableError } from "./inference-error.js";

function unavailable(reason: string): string {
  return [
    `⚠ The write was applied, but post-write verification is unavailable: ${reason}.`,
    "Run `branch doctor --fix` on the machine running Branch Agent, then verify the configuration before continuing.",
  ].join("\n");
}

export async function verifyConfigAfterSystemAgentWrite(
  resolveRepair: (message: string) => Promise<{ text: string }>,
): Promise<string | null> {
  let issuesText: string;
  try {
    const { readConfigFileSnapshot } = await import("../config/config.js");
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.exists) {
      return unavailable("branch.json was not found");
    }
    if (snapshot.valid) {
      return null;
    }
    const issues = (snapshot.issues ?? []).map(
      (issue: { path?: string; message: string }) =>
        `${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
    );
    issuesText = issues.length > 0 ? issues.join("\n") : "unknown validation failure";
  } catch {
    return unavailable("branch.json could not be read");
  }
  return await resolveConfigWriteRepair(issuesText, resolveRepair, true);
}

export async function resolveConfigWriteRepair(
  issuesText: string,
  resolveRepair: (message: string) => Promise<{ text: string }>,
  applied = false,
): Promise<string> {
  const notice = applied
    ? `⚠ branch.json failed validation after that write:\n${issuesText}`
    : `The config write failed; proposing a fix.\n${issuesText}`;
  let recovery: { text: string };
  try {
    recovery = await resolveRepair(
      `[config-verify] ${applied ? "The config file is now invalid" : "The config write failed"}:\n${issuesText}\n${applied ? "" : "If the report says the config was written, inspect the current value before correcting it. "}Propose one corrective command from the allowed list.`,
    );
  } catch (error) {
    if (!isSystemAgentInferenceUnavailableError(error)) {
      throw error;
    }
    return `${notice}\n${applied ? "The write was applied, but inference" : "Inference"} could not propose a repair. Run \`branch doctor --fix\` on the machine running Branch Agent, then try again.`;
  }
  return recovery.text
    ? `${notice}\n\n${recovery.text}`
    : `${notice}\nUse \`config schema <path>\` here to check the expected shape. Or, with Branch Agent stopped, run \`branch doctor --fix\` on the machine running it.`;
}
