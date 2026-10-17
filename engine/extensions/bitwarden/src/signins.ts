import { encodeBitwardenSecretId } from "../bitwarden-secret-id.js";
import type { BitwardenConfig, BitwardenSignIn } from "./config.js";

export type BitwardenSecretRef = { source: "exec"; provider: string; id: string };

/**
 * One sign-in Branch may fill. It carries SecretRefs, never values: the Gateway resolves them
 * through the Bitwarden provider at fill time, so the agent never reads the password.
 */
export type BitwardenFillEntry = {
  slug: string;
  description?: string;
  sites: string[];
  refs: {
    username: BitwardenSecretRef;
    password: BitwardenSecretRef;
    totp?: BitwardenSecretRef;
  };
};

function ref(provider: string, item: string, field: string): BitwardenSecretRef {
  return { source: "exec", provider, id: encodeBitwardenSecretId(`${item}/${field}`) };
}

function toFillEntry(providerAlias: string, signIn: BitwardenSignIn): BitwardenFillEntry {
  return {
    slug: signIn.slug,
    ...(signIn.description ? { description: signIn.description } : {}),
    sites: [...signIn.sites],
    refs: {
      username: ref(providerAlias, signIn.item, "username"),
      password: ref(providerAlias, signIn.item, "password"),
      ...(signIn.totp ? { totp: ref(providerAlias, signIn.item, "totp") } : {}),
    },
  };
}

/** Every sign-in Branch may fill, in slug order. */
export function listFillEntries(config: BitwardenConfig): BitwardenFillEntry[] {
  return config.signIns.map((signIn) => toFillEntry(config.providerAlias, signIn));
}

/** The host a page URL may be filled on, or undefined when the page must never be filled. */
export function fillableHost(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (parsed.username || parsed.password) {
    return undefined;
  }
  if (parsed.protocol === "https:") {
    return host;
  }
  // Plain http only for this computer: a password must not cross the network unencrypted.
  return parsed.protocol === "http:" && host === "localhost" ? host : undefined;
}

/** Sign-ins whose sites list holds the page's exact host. Subdomains and look-alikes never match. */
export function matchFillEntries(config: BitwardenConfig, url: string): BitwardenFillEntry[] {
  const host = fillableHost(url);
  if (!host) {
    return [];
  }
  return config.signIns
    .filter((signIn) => signIn.sites.includes(host))
    .map((signIn) => toFillEntry(config.providerAlias, signIn));
}
