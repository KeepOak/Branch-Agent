export type BitwardenSecretField =
  | { kind: "login"; name: "username" | "password" | "totp" | "notes" | "uri" }
  | { kind: "custom"; name: string };

export const BITWARDEN_LOGIN_FIELDS: readonly string[];
export function parseBitwardenSecretId(value: string): {
  item: string;
  field: BitwardenSecretField;
};
export function encodeBitwardenSecretId(value: string): string;
