// Branch-original shared safety piece (atlas SAFETY-0200, G-1684): an email From address is an identity only
// with an aligned DMARC, SPF or DKIM pass in the first Authentication-Results header from a trusted server
// (RFC 8601 header, RFC 7489 relaxed alignment). Anything else is a stranger.

export type EmailSenderIdentity =
  | { kind: "identity"; address: string; via: "dmarc" | "dkim" | "spf" }
  | { kind: "stranger"; reason: "no-from" | "no-trusted-results" | "not-aligned" };

type MethodResult = { method: string; result: string; props: Map<string, string> };

function unfold(value: string): string {
  return value.replace(/\r?\n[ \t]+/g, " ").replace(/\([^)]*\)/g, " ");
}

/** Parse one Authentication-Results value into its authserv-id and method results. */
export function parseAuthenticationResults(value: string): { authservId: string; results: MethodResult[] } {
  const parts = unfold(value).split(";").map((part) => part.trim()).filter(Boolean);
  const authservId = (parts.shift() ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  const results = parts.flatMap((part): MethodResult[] => {
    const tokens = part.split(/\s+/);
    const head = /^([a-z0-9-]+)=([a-z]+)$/i.exec(tokens[0] ?? "");
    if (!head) {
      return [];
    }
    const props = new Map<string, string>();
    for (const token of tokens.slice(1)) {
      const prop = /^([a-z0-9._-]+)=(.+)$/i.exec(token);
      if (prop) {
        props.set((prop[1] ?? "").toLowerCase(), (prop[2] ?? "").replace(/^"|"$/g, "").toLowerCase());
      }
    }
    return [{ method: (head[1] ?? "").toLowerCase(), result: (head[2] ?? "").toLowerCase(), props }];
  });
  return { authservId, results };
}

function domainOf(address: string | undefined): string | undefined {
  const at = address?.lastIndexOf("@") ?? -1;
  return address && at > 0 ? address.slice(at + 1).toLowerCase().replace(/>$/, "") : undefined;
}

/**
 * Alignment: the same domain, or one is a parent domain of the other. Sibling subdomains do not align here;
 * without the public suffix list a "last two labels" rule would align example.co.uk with attacker.co.uk.
 */
export function domainsAlign(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || !a.includes(".") || !b.includes(".")) {
    return false;
  }
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function alignedPass(
  results: MethodResult[],
  fromDomain: string,
): "dmarc" | "dkim" | "spf" | undefined {
  for (const [method, key] of [["dmarc", "header.from"], ["dkim", "header.d"], ["spf", "smtp.mailfrom"]] as const) {
    const pass = results.find((entry) => {
      if (entry.method !== method || entry.result !== "pass") {
        return false;
      }
      const value = entry.props.get(key);
      return domainsAlign(value?.includes("@") ? domainOf(value) : value, fromDomain);
    });
    if (pass) {
      return method;
    }
  }
  return undefined;
}

/** Only the first header whose authserv-id is trusted counts; headers above it from others are ignored. */
export function resolveEmailSenderIdentity(params: {
  from: string | undefined;
  authenticationResults: readonly string[];
  trustedAuthservIds: readonly string[];
}): EmailSenderIdentity {
  const fromDomain = domainOf(params.from?.trim());
  if (!params.from || !fromDomain) {
    return { kind: "stranger", reason: "no-from" };
  }
  const trusted = new Set(params.trustedAuthservIds.map((id) => id.toLowerCase()));
  const header = params.authenticationResults
    .map(parseAuthenticationResults)
    .find((parsed) => trusted.has(parsed.authservId));
  if (!header) {
    return { kind: "stranger", reason: "no-trusted-results" };
  }
  const via = alignedPass(header.results, fromDomain);
  return via
    ? { kind: "identity", address: params.from.trim().toLowerCase(), via }
    : { kind: "stranger", reason: "not-aligned" };
}
