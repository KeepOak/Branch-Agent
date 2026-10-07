# Branch App Feature Map Index

Quick guide to every screen in the Branch desktop app and how to reach it.

## Main Places (Sidebar)

Click the place name in the left sidebar to navigate.

### 1. Overview (`place: overview`)
**Dashboard and system status**
- Health tile (backups, updates, gateway)
- Activity summary
- People currently working
- Source: `window/src/places/overview/`

### 2. Canopy (`place: canopy`)
**All runs, helpers, computers, and automation cards**
- **Now tab**: Currently running tasks
- **Cards tab**: Saved automation configurations
- Source: `window/src/places/canopy/`

### 3. Inbox (`place: inbox`)
**Messages and items needing attention**
- **Needs you**: Approvals and actions required
- **Finished**: Completed items
- **History**: Past inbox items
- **Later**: Deferred items
- Source: `window/src/places/inbox/`

### 4. Automations (`place: automations`)
**Scheduled tasks and workflows**
- **Scheduled**: Time-based automation
- **Procedures**: Defined workflows
- **Triggers**: Event-based automation
- **Check-ins**: Periodic tasks
- **Board**: Visual automation board
- Source: `window/src/places/automations/`

### 5. Library (`place: library`)
**Knowledge and created content**
- **Memory**: Saved context and memories
- **Documents**: Document library
- **Meetings**: Meeting records
- **Made for you**: AI-generated content
- **Logbook**: Activity logs
- Source: `window/src/places/library/`

### 6. People (`place: people`)
**Users, teams, and collaboration**
- **Live now**: Active users and sessions
- **People**: User directory
- **Access groups**: Permission groups
- **Shared**: Shared resources
- **Teams**: Team management
- **Activity**: User activity logs
- **Usage**: Per-user resource usage
- **Rules**: Access policies
- **Signing in**: Authentication settings
- Source: `window/src/places/people/`

### 7. Customize (`place: customize`)
**Configuration for Trunks and tools**
- **Trunks**: Manage AI assistants
- **Tools**: Configure integrations
- **Specialists**: Specialized agents
- **Chat apps**: Messaging platforms
- **Everywhere**: Global settings
- Source: `window/src/places/customize/`

## Settings (Gear Icon)

Click the gear icon in the sidebar, then select a category. Navigate with: `Settings › <category name>`

### Core Settings
- **General**: App behavior and startup
- **People**: User management
- **Appearance**: Theme (light/dark/system)
- **Notifications**: Alert preferences
- **Instructions**: Edit Trunk instruction files
- **Models**: AI model selection
- **Local**: Local model settings
- **Accounts**: Connected accounts
- **Voice**: Speech and voice input
- **Chat apps**: Messaging platform settings
- **Permissions**: Approval policies

### System Settings
- **Computer**: Computer and browser control
- **Secrets**: Credential management
- **Usage**: Resource quotas and spending
- **Backups**: Backup configuration
- **Gateway**: Gateway service settings
- **Self**: Self-modification settings
- **Agents**: Cloud agent settings
- **Seasons**: Memory rings and improvements
- **Updates**: App update management
- **Achievements**: Milestones
- **Advanced**: Technical controls
- **Developer**: Diagnostic information

Source: `window/src/places/settings/`

## Conversations

Active chat threads with Trunks. Click a conversation in the sidebar conversation list or start one from a Place.

Source: `window/src/thread/`, `window/src/composer/`

## Navigation Patterns

### Using `ui_navigate` Tool
Navigate multi-step paths by clicking controls in sequence:
```
ui_navigate("Settings › Usage")  # Opens Settings, then clicks Usage
ui_navigate("Customize")         # Opens Customize place
ui_navigate("Canopy › Now")      # Not needed - tabs use ui_click
```

The separator is `›` (option+shift+\ on Mac, AltGr+W elsewhere).

### Tab Navigation
Within a Place with tabs:
1. Use `ui_click` with the tab name: `ui_click(name="Memory")`
2. Or use keyboard: ArrowLeft/Right between tabs, Home/End for first/last

### Finding Controls
1. Use `ui_snapshot()` to get the accessibility tree with refs
2. Click by ref: `ui_click(ref="e12")` or by name: `ui_click(name="Save changes")`
3. Unnamed controls are listed in the snapshot's `unlabeled` field

## Source File Organization

- **Places**: `window/src/places/<place-name>/`
- **Settings pages**: `window/src/places/settings/set1/` (user-facing) and `set2/` (system)
- **Navigation**: `window/src/places-nav/`
- **Conversations**: `window/src/thread/`, `window/src/composer/`
- **Sidebar**: `window/src/places-nav/Sidebar.tsx`
- **Routes**: `window/src/places-nav/routes.ts`

## Verification Workflow

See `.cursor/skills/verify-in-app/SKILL.md` for the complete guide to:
1. Starting a scratch test instance
2. Navigating to any screen
3. Capturing screenshots
4. Adding them to a PR

The feature map is validated in CI: `scripts/feature-map-check.mjs` ensures every listed source file exists.
# Updated to trigger workflow
