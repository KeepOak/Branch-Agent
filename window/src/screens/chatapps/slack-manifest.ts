// Socket-mode recipe copied from engine/extensions/slack/src/setup-shared.ts.
export const SLACK_MANIFEST = {
  "display_information": {
    "name": "Branch Agent",
    "description": "Branch Agent connector for Branch Agent"
  },
  "features": {
    "bot_user": {
      "display_name": "Branch Agent",
      "always_online": true
    },
    "app_home": {
      "home_tab_enabled": true,
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    },
    "agent_view": {
      "agent_description": "Branch Agent connects Slack Agent View conversations to Branch Agent agents.",
      "suggested_prompts": [
        {
          "title": "What can you do?",
          "message": "What can you help me with?"
        },
        {
          "title": "Summarize this channel",
          "message": "Summarize the recent activity in this channel."
        },
        {
          "title": "Draft a reply",
          "message": "Help me draft a reply."
        }
      ]
    },
    "slash_commands": [
      {
        "command": "/branch",
        "description": "Send a message to Branch Agent",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read",
        "assistant:write",
        "channels:history",
        "channels:read",
        "chat:write",
        "commands",
        "emoji:read",
        "files:read",
        "files:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "mpim:write",
        "pins:read",
        "pins:write",
        "reactions:read",
        "reactions:write",
        "usergroups:read",
        "users:read"
      ]
    }
  },
  "settings": {
    "socket_mode_enabled": true,
    "event_subscriptions": {
      "bot_events": [
        "app_home_opened",
        "app_mention",
        "app_context_changed",
        "agent_session_stopped",
        "agent_session_title_changed",
        "channel_rename",
        "member_joined_channel",
        "member_left_channel",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
        "pin_added",
        "pin_removed",
        "reaction_added",
        "reaction_removed"
      ]
    }
  }
};
