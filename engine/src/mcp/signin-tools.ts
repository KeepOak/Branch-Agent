import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  GitHubIdentityFacts,
  ToolsGitHubStatusResult,
} from "../../packages/gateway-protocol/src/index.js";
import type { ModelAuthStatusResult } from "../gateway/server-methods/models-auth-status.types.js";
import type { TrunkGateway } from "./trunk-tools.js";

type ModelState = "ok" | "expired" | "missing" | "error";
type ModelSignIn = { provider: string; account_label: string; state: ModelState; detail: string };
type GitHubSignIn = { state: "ok" | "retrying" | "disconnected" | "error"; detail: string };

function modelState(status: unknown): ModelState {
  // Static credentials and credentials nearing expiry are still usable now.
  if (status === "ok" || status === "static" || status === "expiring") return "ok";
  if (status === "expired" || status === "missing") return status;
  return "error";
}

function githubState(identity: GitHubIdentityFacts | null): GitHubSignIn {
  if (!identity || identity.credentialKind === "native") {
    return { state: "disconnected", detail: "Managed GitHub sign-in missing" };
  }
  if (identity.refreshState === "refreshing") {
    return { state: "retrying", detail: "GitHub sign-in refresh in progress" };
  }
  if (
    identity.credentialState === "unavailable" ||
    identity.credentialState === "configured_unavailable"
  ) {
    return { state: "disconnected", detail: "Managed GitHub sign-in disconnected" };
  }
  if (identity.credentialState !== "available") {
    return { state: "error", detail: "GitHub sign-in could not be verified" };
  }
  if (["failed", "expired", "unavailable"].includes(identity.refreshState)) {
    return { state: "error", detail: "GitHub sign-in refresh unavailable" };
  }
  return { state: "ok", detail: "GitHub sign-in available" };
}

export function registerSigninMcpTools(server: McpServer, gw: TrunkGateway): void {
  server.tool(
    "signin_check",
    "Read current model account and managed GitHub sign-in status without refreshing or retrying.",
    {},
    async () => {
      const checked_at = new Date().toISOString();
      let models: ModelSignIn[];
      let github: GitHubSignIn;
      try {
        const status = await gw.request<ModelAuthStatusResult>("models.authStatus", {});
        if (status.unavailable || !Array.isArray(status.providers))
          throw new Error("Unavailable model status");
        models = status.providers.flatMap((provider) => {
          // Provider ids are protocol identifiers, never account identities.
          if (!/^[a-z0-9][a-z0-9._-]*$/i.test(provider.provider))
            throw new Error("Invalid provider");
          const service =
            provider.provider === "openai-codex"
              ? "ChatGPT"
              : provider.provider === "anthropic"
                ? "Claude"
                : provider.provider;
          const order = provider.profileOrder ?? [];
          const rank = (id: string) => {
            const index = order.indexOf(id);
            return index < 0 ? order.length : index;
          };
          const profiles = [...provider.profiles].sort(
            (a, b) => rank(a.profileId) - rank(b.profileId),
          );
          const rows: Array<{
            status: unknown;
            displayName?: string;
            profileId?: string;
            email?: string;
          }> = profiles.length ? profiles : [{ status: provider.status }];
          return rows.map((profile, index) => {
            // Never fall back to emails or profile/user ids when a display label is absent.
            const name = profile.displayName;
            const account_label =
              name &&
              !name.includes(String.fromCharCode(64)) &&
              name !== profile.profileId &&
              name !== profile.email
                ? name
                : `${service} ${index + 1}`;
            const state = modelState(profile.status);
            const detail =
              state === "ok"
                ? "Sign-in available"
                : state === "expired"
                  ? "Sign-in expired"
                  : state === "missing"
                    ? "Sign-in missing"
                    : "Sign-in status unavailable";
            return { provider: provider.provider, account_label, state, detail };
          });
        });
      } catch {
        models = [
          {
            provider: "models",
            account_label: "Model accounts",
            state: "error",
            detail: "Model sign-in status unavailable",
          },
        ];
      }
      try {
        // The app's system-scope connection state, not a detected native gh login.
        const agents = await gw.request<{ defaultId: string }>("agents.list", {});
        if (!agents.defaultId) throw new Error("Default Trunk unavailable");
        const status = await gw.request<ToolsGitHubStatusResult>("tools.github.status", {
          agentId: agents.defaultId,
          selectedScope: "system",
        });
        github = githubState(status.selected.identity);
      } catch {
        github = { state: "error", detail: "GitHub sign-in status unavailable" };
      }
      const attention = models
        .filter((model) => model.state !== "ok")
        .map((model) => `${model.account_label} (${model.state})`);
      if (github.state !== "ok") attention.push(`GitHub (${github.state})`);
      const overall = attention.length ? "attention" : "ok";
      const text = attention.length
        ? `sign-ins need attention: ${attention.join(", ")}`
        : "sign-ins ok";
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { checked_at, overall, models, github },
      };
    },
  );
}
