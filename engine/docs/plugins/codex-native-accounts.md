# Native Codex account homes

Branch can select between already-authenticated native Codex homes without importing
or copying their credentials. This is a Codex-only, local stdio feature; it does not
provide Claude Code account failover or an account-login UI.

Configure `plugins.entries.codex.config.appServer`:

```json
{
  "homeScope": "user",
  "transport": "stdio",
  "nativeAccounts": [
    { "id": "personal", "home": "/absolute/path/to/personal-codex-home" },
    { "id": "work", "home": "/absolute/path/to/work-codex-home" }
  ],
  "nativeAccountId": "personal",
  "nativeAccountQuotaFailover": true
}
```

On Windows use absolute Windows paths. Each home must already be authenticated by
the operator using the native Codex login flow. Homes and IDs must be distinct.
Do not combine this registry with `codexHome`, a Branch auth-profile selection,
remote/sandbox placement, or a supervised native thread.

For a new Branch thread, Branch probes native login status and reads structured
account quota in a throwaway app-server connection **before starting any turn**.
Only a positive exhausted-quota result permits admission through the next configured
account. Unknown quota keeps the selected account; login, network and other errors
stop admission. Ambient API-key/access-token environment variables are cleared so
they cannot replace the chosen home login.
API-key native logins are rejected by this subscription-account registry rather
than admitting a metered turn or trying another home.

The admitted home is saved in the native thread binding and preserved for subsequent
turns, side questions, compaction and tool-free settled-turn finalization. Finalization
retains the captured home, does not forward Branch credentials, and fails if that
home is removed from the registry. Changing the configured default does not move
an existing thread to another account. Existing bindings without a registered home
owner require explicit migration rather than automatic adoption.

Once a turn starts, Branch does **not** replay it on another account, including when
the turn reports a quota failure. Completed tools and native thread history cannot
be safely replayed or moved between account homes by this feature. Automatic
mid-conversation account migration is not implemented.

For a single explicitly chosen native home, `appServer.codexHome` is also supported
with `homeScope: "user"` and `transport: "stdio"`; it does not enable failover.
