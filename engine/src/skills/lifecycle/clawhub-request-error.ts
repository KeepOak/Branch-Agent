import { formatCliCommand } from "../../cli/command-format.js";
import { ClawHubRequestError } from "../../infra/clawhub-client.js";
import { formatErrorMessage } from "../../infra/errors.js";

export function formatClawHubSkillRequestError(
  error: unknown,
  params: { slug: string; operation: "install" | "verify" },
): string {
  if (!(error instanceof ClawHubRequestError)) {
    return formatErrorMessage(error);
  }
  const skillPath = `/api/v1/skills/${encodeURIComponent(params.slug)}`;
  if (
    error.status === 404 &&
    (error.requestPath.endsWith(skillPath) ||
      error.requestPath.endsWith(`${skillPath}/install`) ||
      error.requestPath.endsWith(`${skillPath}/verify`))
  ) {
    // Seedbank said this slug is not in the registry, so listing locally installed skills cannot
    // resolve it; search is the only next step that can find the right slug.
    return `Skill "${params.slug}" not found on Seedbank. Run \`${formatCliCommand(`branch skills search ${params.slug}`)}\` to find the right skill reference.`;
  }
  const action = params.operation === "install" ? "installing" : "verifying";
  if (error.status === 401) {
    return `Seedbank authentication failed while ${action} skill "${params.slug}". Authenticate with Seedbank and try again.`;
  }
  if (error.status === 403) {
    return `Seedbank denied access while ${action} skill "${params.slug}". Check your Seedbank access and try again.`;
  }
  if (error.status === 429) {
    return `Seedbank rate limit reached while ${action} skill "${params.slug}". Wait and try again later.`;
  }
  if (error.status >= 500) {
    return `Seedbank is temporarily unavailable while ${action} skill "${params.slug}". Try again later.`;
  }
  return `Seedbank could not ${params.operation} skill "${params.slug}". Check the skill reference and try again.`;
}
