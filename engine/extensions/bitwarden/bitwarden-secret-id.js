const ENCODED_SECRET_ID_PREFIX = "bwb64:";
const EXEC_SECRET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;
const MAX_NATIVE_SECRET_ID_BYTES = 1024;

/** Login fields a Bitwarden SecretRef can name directly; custom fields use "fields/<name>". */
export const BITWARDEN_LOGIN_FIELDS = Object.freeze([
  "username",
  "password",
  "totp",
  "notes",
  "uri",
]);

function invalidSecretId(message) {
  return new Error(`Invalid Bitwarden SecretRef id: ${message}`);
}

function assertSafeNativeSecretId(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidSecretId("the value is empty.");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_NATIVE_SECRET_ID_BYTES) {
    throw invalidSecretId(`the value exceeds ${MAX_NATIVE_SECRET_ID_BYTES} bytes.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw invalidSecretId("control characters are not allowed.");
    }
  }
}

function splitNativeSecretId(value) {
  const parts = value.split("/");
  if (parts.length >= 3 && parts.at(-2) === "fields") {
    const item = parts.slice(0, -2).join("/");
    const name = parts.at(-1);
    if (!name) {
      throw invalidSecretId('custom fields use "<item>/fields/<field name>".');
    }
    return { item, field: { kind: "custom", name } };
  }
  if (parts.length < 2) {
    throw invalidSecretId(
      'use "<item>/<field>" (username, password, totp, notes, uri) or "<item>/fields/<field name>".',
    );
  }
  const name = parts.at(-1);
  if (!BITWARDEN_LOGIN_FIELDS.includes(name)) {
    throw invalidSecretId(
      `unknown field "${name}"; use username, password, totp, notes, uri, or fields/<field name>.`,
    );
  }
  return { item: parts.slice(0, -1).join("/"), field: { kind: "login", name } };
}

function assertItem(item) {
  if (!item || item.trim() !== item) {
    throw invalidSecretId("the item must be a non-empty name or id without surrounding spaces.");
  }
  // The item lands in bw argv; a leading hyphen would parse as a CLI flag.
  if (item.startsWith("-")) {
    throw invalidSecretId("the item must not start with a hyphen.");
  }
}

function decodeBitwardenSecretId(value) {
  if (!value.startsWith(ENCODED_SECRET_ID_PREFIX)) {
    return value;
  }
  const payload = value.slice(ENCODED_SECRET_ID_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw invalidSecretId("the encoded reference is malformed.");
  }
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64url") !== payload) {
    throw invalidSecretId("the encoded reference is malformed.");
  }
  return decoded;
}

/**
 * Parse a Bitwarden SecretRef id into the vault item (name or id) and the field to read.
 * Ids are "<item>/<field>", "<item>/fields/<custom field>", or the "bwb64:" form of either.
 */
export function parseBitwardenSecretId(value) {
  if (typeof value !== "string") {
    throw invalidSecretId("the value is empty.");
  }
  const native = decodeBitwardenSecretId(value);
  assertSafeNativeSecretId(native);
  const parsed = splitNativeSecretId(native);
  assertItem(parsed.item);
  return parsed;
}

/** Encode a native "<item>/<field>" reference into an id that fits exec SecretRef ids. */
export function encodeBitwardenSecretId(value) {
  assertSafeNativeSecretId(value);
  const parsed = splitNativeSecretId(value);
  assertItem(parsed.item);
  if (
    EXEC_SECRET_ID_PATTERN.test(value) &&
    !value.startsWith(ENCODED_SECRET_ID_PREFIX) &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return value;
  }
  const encoded = `${ENCODED_SECRET_ID_PREFIX}${Buffer.from(value, "utf8").toString("base64url")}`;
  if (!EXEC_SECRET_ID_PATTERN.test(encoded)) {
    throw invalidSecretId(
      "the encoded reference exceeds Branch Agent's exec SecretRef limit; use the Bitwarden item id instead of its name.",
    );
  }
  return encoded;
}
