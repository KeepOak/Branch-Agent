import fs from "node:fs";
import { validateJsonSchemaValue } from "branch/plugin-sdk/json-schema-runtime";
import { expect, it } from "vitest";
import { resolveImapConfig } from "./config.js";
import { imapMessageMatchesFilter, readImapMatchFilter } from "./trigger.js";

const account = {
  host: "imap.example.com",
  user: "reader@example.com",
  password: "fixture-password",
  agentId: "mail_reader",
};

it("accepts a blank or text filter and rejects anything else", () => {
  expect(readImapMatchFilter(undefined, "inbox")).toBe("");
  expect(readImapMatchFilter("  Invoice  ", "inbox")).toBe("Invoice");
  expect(resolveImapConfig({ accounts: { inbox: { ...account, match: " Invoice " } } }).accounts.inbox)
    .toMatchObject({ match: "Invoice", mailbox: "INBOX", agentId: "mail_reader" });
  expect(resolveImapConfig({ accounts: { inbox: account } }).accounts.inbox?.match).toBe("");
  for (const match of [1, false, { contains: "invoice" }]) {
    expect(() => resolveImapConfig({ accounts: { inbox: { ...account, match } } })).toThrow(
      "filter must be text",
    );
  }
  expect(() =>
    resolveImapConfig({ accounts: { inbox: { ...account, match: "x".repeat(201) } } }),
  ).toThrow("filter is too long");
});

it("validates the filter against the plugin schema", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../branch.plugin.json", import.meta.url), "utf8"),
  ) as { configSchema: Record<string, unknown> };
  const value = (match: unknown) => ({
    accounts: { inbox: { ...account, match } },
  });
  expect(
    validateJsonSchemaValue({
      schema: manifest.configSchema,
      cacheKey: "imap.manifest.config-schema",
      value: value("invoice"),
    }).ok,
  ).toBe(true);
  expect(
    validateJsonSchemaValue({
      schema: manifest.configSchema,
      cacheKey: "imap.manifest.config-schema",
      value: value("x".repeat(201)),
    }).ok,
  ).toBe(false);
});

it("matches sender or subject text and ignores the rest", () => {
  expect(imapMessageMatchesFilter("", "Ada <ada@example.com>", "Hello")).toBe(true);
  expect(imapMessageMatchesFilter("   ", "Ada <ada@example.com>", "Hello")).toBe(true);
  expect(imapMessageMatchesFilter("ada", "Ada <ada@example.com>", "Hello")).toBe(true);
  expect(imapMessageMatchesFilter("InVoIcE", "Ada <ada@example.com>", "Your invoice")).toBe(true);
  expect(imapMessageMatchesFilter("receipt", "Ada <ada@example.com>", "Your invoice")).toBe(false);
});
