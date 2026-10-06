# Long-tail delivery (send-only)

`channels.longtail` provides outbound delivery to services that do not have a
bundled inbound adapter. Configure one account per service. It does not read
messages, react, edit, or show typing status; those controls are unavailable.

```json
{
  "channels": {
    "longtail": {
      "accounts": {
        "team": {
          "provider": "rocket-chat",
          "baseUrl": "https://chat.example.com/",
          "token": "YOUR_AUTH_TOKEN",
          "userId": "YOUR_USER_ID",
          "defaultTo": "ROOM_ID"
        },
        "alerts": {
          "provider": "ntfy",
          "baseUrl": "https://ntfy.example.com/",
          "token": "OPTIONAL_ACCESS_TOKEN",
          "defaultTo": "branch-alerts"
        }
      }
    }
  }
}
```

Send with the `message` tool using channel `longtail`, the account ID, and a
target as follows. `defaultTo` can replace the target when configured.

| Provider | Required account fields | Target |
| --- | --- | --- |
| Rocket.Chat | `baseUrl`, `token`, `userId` | Room ID |
| Zulip | `baseUrl`, `token`, `email` | `stream/<name>/<topic>` or `dm/<email-or-id>` |
| Webex | `token` (`baseUrl` optional) | `room/<id>` or `person/<email>` |
| Gotify | `baseUrl`, `token` | `default` (configured application) |
| Pushover | `token` | User or group key |
| ntfy | `baseUrl` optional; `token` optional for public topics | Topic name |

The account settings are operator-owned secrets. Keep the token in protected
configuration. The channel acknowledges only IDs returned by the provider.
