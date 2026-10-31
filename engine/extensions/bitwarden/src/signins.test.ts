import { describe, expect, it } from "vitest";
import { encodeBitwardenSecretId, parseBitwardenSecretId } from "../bitwarden-secret-id.js";
import { parseBitwardenConfig } from "./config.js";
import { fillableHost, listFillEntries, matchFillEntries } from "./signins.js";

const config = parseBitwardenConfig({
  signIns: {
    github: { item: "GitHub", sites: ["GitHub.com", "github.com."], totp: true },
    mail: { item: "Work Mail Account", sites: ["mail.example.com"], description: "Work mail" },
  },
});

describe("Bitwarden SecretRef ids", () => {
  it("keeps plain ids and encodes names that exec ids cannot hold", () => {
    expect(encodeBitwardenSecretId("GitHub/password")).toBe("GitHub/password");
    const encoded = encodeBitwardenSecretId("Work Mail Account/fields/api key");
    expect(encoded).toMatch(/^bwb64:[A-Za-z0-9_-]+$/u);
    expect(parseBitwardenSecretId(encoded)).toEqual({
      item: "Work Mail Account",
      field: { kind: "custom", name: "api key" },
    });
    expect(parseBitwardenSecretId("a/b/totp")).toEqual({
      item: "a/b",
      field: { kind: "login", name: "totp" },
    });
  });

  it("rejects unknown fields, flag-like items and malformed encodings", () => {
    expect(() => parseBitwardenSecretId("GitHub")).toThrow(/use "<item>\/<field>"/);
    expect(() => parseBitwardenSecretId("GitHub/secret")).toThrow(/unknown field/);
    expect(() => parseBitwardenSecretId("--session/password")).toThrow(/hyphen/);
    expect(() => parseBitwardenSecretId("bwb64:***")).toThrow(/malformed/);
  });
});

describe("Bitwarden sign-ins Branch may fill", () => {
  it("lists sign-ins as SecretRefs, never values", () => {
    expect(listFillEntries(config)).toEqual([
      {
        slug: "github",
        sites: ["github.com"],
        refs: {
          username: { source: "exec", provider: "bitwarden", id: "GitHub/username" },
          password: { source: "exec", provider: "bitwarden", id: "GitHub/password" },
          totp: { source: "exec", provider: "bitwarden", id: "GitHub/totp" },
        },
      },
      {
        slug: "mail",
        description: "Work mail",
        sites: ["mail.example.com"],
        refs: {
          username: {
            source: "exec",
            provider: "bitwarden",
            id: encodeBitwardenSecretId("Work Mail Account/username"),
          },
          password: {
            source: "exec",
            provider: "bitwarden",
            id: encodeBitwardenSecretId("Work Mail Account/password"),
          },
        },
      },
    ]);
  });

  it("uses a custom provider alias", () => {
    const aliased = parseBitwardenConfig({
      providerAlias: "bw-home",
      signIns: { github: { item: "GitHub", sites: ["github.com"] } },
    });
    expect(listFillEntries(aliased)[0]?.refs.password.provider).toBe("bw-home");
  });

  it("matches only the exact host over https", () => {
    expect(matchFillEntries(config, "https://github.com/login").map((e) => e.slug)).toEqual([
      "github",
    ]);
    expect(matchFillEntries(config, "https://GITHUB.com./session").map((e) => e.slug)).toEqual([
      "github",
    ]);
    for (const url of [
      "http://github.com/login",
      "https://gist.github.com/login",
      "https://github.com.evil.example/login",
      "https://user:pass@github.com/login",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(matchFillEntries(config, url), url).toEqual([]);
    }
    expect(fillableHost("http://localhost:3000/")).toBe("localhost");
  });

  it("rejects sites that are not exact host names", () => {
    for (const site of [
      "*.github.com",
      "https://github.com",
      "github.com:443",
      "github.com/login",
      "github",
    ]) {
      expect(
        () => parseBitwardenConfig({ signIns: { gh: { item: "GitHub", sites: [site] } } }),
        site,
      ).toThrow(/exact host name/);
    }
    expect(() => parseBitwardenConfig({ signIns: { gh: { item: "GitHub", sites: [] } } })).toThrow(
      /at least one site/,
    );
    expect(() =>
      parseBitwardenConfig({ signIns: { GH: { item: "GitHub", sites: ["github.com"] } } }),
    ).toThrow(/lowercase/);
    expect(() =>
      parseBitwardenConfig({ signIns: { gh: { item: "-x", sites: ["github.com"] } } }),
    ).toThrow(/hyphen/);
  });

  it("treats an empty config as SecretRefs only", () => {
    expect(parseBitwardenConfig(undefined)).toEqual({ providerAlias: "bitwarden", signIns: [] });
  });
});
