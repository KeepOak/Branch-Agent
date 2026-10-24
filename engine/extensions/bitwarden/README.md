# Bitwarden

Resolve Branch Agent credentials from a Bitwarden vault using SecretRefs, and keep
the list of saved sign-ins Branch may fill. Configuration stores references to
Bitwarden items and fields; the Gateway resolves them when it needs them, so the
agent never reads a password and none is written back into configuration.

## Get started

1. Install the official Bitwarden CLI (`bw`), log in, and enable the plugin with
   `branch plugins enable bitwarden`.
2. Point a secrets provider at the plugin:
   `secrets.providers.bitwarden = { source: "exec", pluginIntegration: { pluginId: "bitwarden", integrationId: "bitwarden" } }`.
3. Unlock the vault for the Gateway: `bw unlock --raw` prints a session key. Save it
   to the file shown by `branch bitwarden status` (owner-only permissions), or set
   `BW_SESSION` for the Gateway. Set `BRANCH_BITWARDEN_BW` when `bw` is not on `PATH`.

## References

A SecretRef id names an item (its id, or its exact name) and a field:

- `<item>/username`, `<item>/password`, `<item>/totp` (the current code),
  `<item>/notes`, `<item>/uri`
- `<item>/fields/<custom field name>`

Names with spaces or other characters use the `bwb64:` form;
`branch bitwarden setup` writes it for you and builds a reviewed SecretRef plan.

## Sign-ins Branch may fill

`plugins.entries.bitwarden.config.signIns` lists the sign-ins Branch may fill,
each with the exact sites it may be used on:

```json5
{ signIns: { github: { item: "GitHub", sites: ["github.com"], totp: true } } }
```

`bitwarden.signins.list` and `bitwarden.signins.match { url }` (Gateway methods)
and `branch bitwarden signins [--url <url>]` return those sign-ins with SecretRefs
for the username, password and code, never their values. A page matches only on
its exact host over https (or http on localhost).
