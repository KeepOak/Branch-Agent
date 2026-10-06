# Chat Relay

An opt-in Branch channel for a remote connector implementing Hermes relay contract v1. The Gateway dials the connector's `/relay` WebSocket endpoint; the connector owns provider credentials and API calls. No inbound listener is opened by this plugin.

```json5
{
  channels: {
    "chat-relay": {
      enabled: true,
      url: "https://connector.example",
      identities: [
        { platform: "discord", botId: "application-id" },
        { platform: "telegram", botId: "bot-id" },
      ],
    },
  },
}
```

`enabled` defaults to false. For a Hermes connector, set `BRANCH_RELAY_GATEWAY_ID` and `BRANCH_RELAY_SECRET` in the Gateway process environment. Branch signs a fresh 300-second upgrade token for each dial. An already-issued bearer may instead be provided as `BRANCH_RELAY_AUTH_TOKEN`. Credentials are never placed in channel config or logged. Outbound targets are `platform:direct:chat-id`, `platform:group:chat-id`, or `platform:channel:chat-id` and are accepted only for a configured platform. Connector-provided `scope_id` and `user_id` are kept in memory for reply routing; they are cleared when the account stops.

The relay protocol has no owner phone number field. Branch does not persist or log a phone number in this plugin; any number required for provider delivery must be supplied to the connector through its own ephemeral onboarding flow. This plugin currently relays text and reply/thread context, not media, interactive controls, or provider provisioning.
