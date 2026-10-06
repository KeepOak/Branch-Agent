---
summary: "Send-only delivery to Rocket.Chat, Zulip, Webex, Gotify, Pushover, and ntfy"
title: "Long-tail delivery"
---

# Long-tail delivery

The `longtail` channel sends messages to six services without enabling inbound
chat. It cannot receive messages, display typing, add reactions, or edit sent
messages. Use a named account for each service.

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

Select channel `longtail`, the account ID, and a provider target in the
`message` tool. If `defaultTo` is set, the target can be omitted.

| Provider | Required settings | Target |
| --- | --- | --- |
| Rocket.Chat | `baseUrl`, `token`, `userId` | Room ID |
| Zulip | `baseUrl`, `token`, `email` | `stream/<name>/<topic>` or `dm/<email-or-id>` |
| Webex | `token` | `room/<id>` or `person/<email>` |
| Gotify | `baseUrl`, `token` | `default` |
| Pushover | `token` | User or group key |
| ntfy | Optional `baseUrl` and `token` | Topic name |

Webex defaults to `https://webexapis.com/` and ntfy to `https://ntfy.sh/`.
Gotify's `default` target is the configured application, not a recipient.
Pushover's API acknowledges a request but does not return a message ID; Branch
therefore leaves its message ID empty.

## Provider API references

- [Rocket.Chat post message](https://developer.rocket.chat/apidocs/post-message)
- [Zulip send message](https://zulip.com/api/send-message)
- [Webex messages](https://developer.webex.com/docs/api/v1/messages)
- [Gotify push messages](https://gotify.net/docs/pushmsg)
- [Pushover message API](https://pushover.net/api)
- [ntfy publish](https://docs.ntfy.sh/publish/)
