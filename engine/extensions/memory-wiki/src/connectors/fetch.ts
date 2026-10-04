// Network access for wiki connectors, through Branch's SSRF guard.
// A connector's configured instance host is allowed (self-hosted GitLab, Gitea, Paperless on a LAN),
// matching how remote embedding endpoints are allowed; plain links use the default guard.
import {
  fetchWithSsrFGuard,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
} from "branch/plugin-sdk/ssrf-runtime";

export type ConnectorFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createGuardedConnectorFetch(allowedBaseUrl?: string): ConnectorFetch {
  const policy = allowedBaseUrl
    ? ssrfPolicyFromHttpBaseUrlAllowedHostname(allowedBaseUrl)
    : undefined;
  return async (url, init) => {
    const { response, release } = await fetchWithSsrFGuard({
      url,
      ...(init ? { init } : {}),
      ...(policy ? { policy } : {}),
      auditContext: "memory-wiki-connector",
    });
    try {
      const nullBody = [101, 204, 205, 304].includes(response.status);
      const body = nullBody ? null : await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      await release();
    }
  };
}
