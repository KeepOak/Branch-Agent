import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { encodeBitwardenSecretId } from "../bitwarden-secret-id.js";

export const DEFAULT_PROVIDER_ALIAS = "bitwarden";
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_SIGN_INS = 64;
export const MAX_SITES_PER_SIGN_IN = 16;
const MAX_DESCRIPTION_LENGTH = 200;
const PROVIDER_ALIAS_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const SITE_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const SITE_PATTERN = new RegExp(`^(?=.{1,253}$)${SITE_LABEL}(?:\\.${SITE_LABEL})*$`);

export type BitwardenSignIn = {
  slug: string;
  /** Bitwarden item id or exact item name. */
  item: string;
  /** Exact host names the sign-in may be filled on. */
  sites: string[];
  totp: boolean;
  description?: string;
};

export type BitwardenConfig = {
  providerAlias: string;
  signIns: BitwardenSignIn[];
};

function fail(message: string): never {
  throw new Error(`Bitwarden config ${message}`);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    fail(`${label} must be a non-empty string`);
  }
  return value.trim();
}

/** Normalize one site entry to a bare lowercase host name: no scheme, port, path or wildcard. */
export function normalizeSite(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(`${label} must be a host name`);
  }
  const site = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!SITE_PATTERN.test(site) || (!site.includes(".") && site !== "localhost")) {
    fail(
      `${label} must be an exact host name such as example.com, without scheme, port, path or wildcard`,
    );
  }
  return site;
}

function readSignIn(slug: string, raw: unknown): BitwardenSignIn {
  if (!SLUG_PATTERN.test(slug)) {
    fail(`sign-in name "${slug}" must use lowercase letters, digits and hyphens`);
  }
  if (!isRecord(raw)) {
    fail(`signIns.${slug} must be an object`);
  }
  const item =
    readString(raw, "item", `signIns.${slug}.item`) ?? fail(`signIns.${slug}.item is required`);
  try {
    encodeBitwardenSecretId(`${item}/password`);
  } catch (error) {
    fail(
      `signIns.${slug}.item is not usable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(raw.sites) || raw.sites.length === 0) {
    fail(`signIns.${slug}.sites must list at least one site`);
  }
  if (raw.sites.length > MAX_SITES_PER_SIGN_IN) {
    fail(`signIns.${slug}.sites must list at most ${MAX_SITES_PER_SIGN_IN} sites`);
  }
  const sites = [
    ...new Set(
      raw.sites.map((site, index) => normalizeSite(site, `signIns.${slug}.sites[${index}]`)),
    ),
  ];
  const description = readString(raw, "description", `signIns.${slug}.description`);
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    fail(`signIns.${slug}.description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  if (raw.totp !== undefined && typeof raw.totp !== "boolean") {
    fail(`signIns.${slug}.totp must be true or false`);
  }
  return {
    slug,
    item,
    sites,
    totp: raw.totp === true,
    ...(description ? { description } : {}),
  };
}

/** Parse plugins.entries.bitwarden.config. An empty config is valid: SecretRefs work without sign-ins. */
export function parseBitwardenConfig(value: unknown): BitwardenConfig {
  const record = isRecord(value) ? value : {};
  const providerAlias =
    readString(record, "providerAlias", "providerAlias") ?? DEFAULT_PROVIDER_ALIAS;
  if (!PROVIDER_ALIAS_PATTERN.test(providerAlias)) {
    fail("providerAlias must be a secrets provider name such as bitwarden");
  }
  const rawSignIns = record.signIns;
  if (rawSignIns !== undefined && !isRecord(rawSignIns)) {
    fail("signIns must be an object");
  }
  const entries = Object.entries(rawSignIns ?? {});
  if (entries.length > MAX_SIGN_INS) {
    fail(`signIns must contain at most ${MAX_SIGN_INS} sign-ins`);
  }
  return {
    providerAlias,
    signIns: entries
      .map(([slug, raw]) => readSignIn(slug, raw))
      .toSorted((a, b) => a.slug.localeCompare(b.slug)),
  };
}
