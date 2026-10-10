#!/usr/bin/env python3
"""Write docs/parity/preview-button-map.json and .md from a curated control list.

Unique product controls in design/spec-v23 (chrome, places, settings, menus,
thread cards, shortcuts). Later-pass interpolated ACTS keys that are not distinct
destinations are omitted; run extract-preview-acts.mjs for the raw act list.
Demo labels only — no hostnames, account emails, or personal paths.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = ROOT / "docs/parity/preview-button-map.json"
OUT_MD = ROOT / "docs/parity/preview-button-map.md"

# (id, screen, label, previewAction, appFile, appComponent, appAction, status)
E = []


def add(id, screen, label, preview, app_file, app_comp, app_action, status):
    E.append(
        {
            "id": id,
            "screen": screen,
            "label": label,
            "previewAction": preview,
            "appFile": app_file,
            "appComponent": app_comp,
            "appAction": app_action,
            "status": status,
        }
    )


# ---------- titlebar ----------
add("titlebar-guide", "titlebar", "Guide",
    "Opens the Guide popover (design notes / critique pins) and toggles the notes layer.",
    "window/src/shell/guide-links.ts", "Guide menu (TopBar + PersonMenu)",
    "Opens the Guide menu: What's new, Set up Branch, walkthrough, Docs, Get help, Community — not the prototype notes layer.",
    "different")
add("titlebar-theme", "titlebar", "Switch light or dark",
    "Toggles document theme between light and dark.",
    "window/src/shell/TopBar.tsx", "TopBar",
    "Toggles light/dark. Shown on place/settings headers; chat uses the conversation ⋯ or person menu Look instead.",
    "different")
add("titlebar-focus", "titlebar", "Clear the view (Ctrl .)",
    "Toggles focus mode (hides sidebar and status bar).",
    "window/src/shell/WindowShell.tsx", "WindowShell",
    "Focus mode exists via Ctrl+. and Leave focus mode. No titlebar eye button.",
    "missing")
add("titlebar-minimize", "titlebar", "Minimize",
    "Shows a toast: Branch keeps working from the tray.",
    "window/src/connect/title-bar.ts", "syncTitleBar (Electron chrome)",
    "Minimize is the OS/Electron window button, not a React control. In a browser there is no minimize control.",
    "different")
add("titlebar-window-focus", "titlebar", "Focus mode",
    "Same as Clear the view: toggles focus mode.",
    "window/src/shell/WindowShell.tsx", "WindowShell",
    "No maximize/focus window button in the React chrome; focus is Ctrl+.",
    "missing")
add("titlebar-quit", "titlebar", "Quit",
    "If a Trunk is working, opens a quit-while-working dialog; otherwise toasts that Branch closes to the tray.",
    "window/src/connect/title-bar.ts", "syncTitleBar (Electron chrome)",
    "Close is the OS/Electron window button. Settings › Gateway has a greyed 'Ask before quitting while work runs' row.",
    "different")
add("titlebar-focus-exit", "titlebar", "Leave focus mode · Ctrl+.",
    "Turns focus mode off.",
    "window/src/shell/WindowShell.tsx", "WindowShell",
    "Same: leaves focus mode.",
    "same")

# ---------- sidebar ----------
add("sidebar-machine", "sidebar", "This computer",
    "Opens the machine switcher menu (talk to the assistant on another computer).",
    "window/src/shell/MachineMenu.tsx", "MachineSwitcher / MachineMenu",
    "Opens the machine switcher. On wide layouts it sits in the top bar, not the sidebar top.",
    "different")
add("sidebar-search", "sidebar", "Search",
    "Focuses sidebar search / opens Find in the list.",
    "window/src/shell/Sidebar.tsx", "Sidebar search slot",
    "Focuses the list search (Ctrl G). Ctrl K opens Find anything instead.",
    "same")
add("sidebar-new", "sidebar", "New",
    "Opens the + new menu.",
    "window/src/shell/Sidebar.tsx", "Sidebar onNew → newMenuItems",
    "Opens the + new menu.",
    "same")
add("sidebar-filter-sort", "sidebar", "Filter and sort",
    "Opens filter/sort popover for the conversation list.",
    "window/src/shell/FilterSort.tsx", "FilterSort",
    "Opens filter and sort.",
    "same")
add("sidebar-row-sapling", "sidebar", "Sapling",
    "Opens the Sapling (default assistant) conversation.",
    "window/src/shell/ConversationRow.tsx", "ConversationRow",
    "Opens the default Trunk's main conversation.",
    "same")
add("sidebar-row-scout", "sidebar", "Scout",
    "Opens the Scout conversation.",
    "window/src/shell/ConversationRow.tsx", "ConversationRow",
    "Opens that Trunk's conversation.",
    "same")
add("sidebar-row-ledger", "sidebar", "Ledger",
    "Opens the Ledger conversation.",
    "window/src/shell/ConversationRow.tsx", "ConversationRow",
    "Opens that Trunk's conversation.",
    "same")
add("sidebar-row-room", "sidebar", "Supplier quotes",
    "Opens the room conversation.",
    "window/src/shell/ConversationRow.tsx", "ConversationRow",
    "Opens that group/room conversation.",
    "same")
add("sidebar-row-ada", "sidebar", "Ada",
    "Opens the Ada conversation.",
    "window/src/shell/ConversationRow.tsx", "ConversationRow",
    "Opens that Trunk's conversation.",
    "same")
add("sidebar-row-fieldnotes", "sidebar", "Fieldnotes",
    "Opens the Fieldnotes conversation.",
    "window/src/shell/ConversationRow.tsx", "ConversationRow",
    "Opens that Trunk's conversation.",
    "same")
add("sidebar-row-new-trunk", "sidebar", "New Trunk",
    "Opens the just-made Trunk's setup conversation.",
    "window/src/shell/NewTrunkFlow.tsx", "NewTrunkFlow",
    "New Trunk is a + menu / Customize action that starts a setup conversation, not a standing demo row.",
    "different")
add("sidebar-row-context-menu", "sidebar", "Conversation row context menu",
    "Right-click / ⋯ on a row opens pin, rename, pause, archive, copy, delete.",
    "window/src/shell/row-menu.ts", "rowMenuItems",
    "Opens the row menu with pin, snooze, archive, copy, rename, and more. Pause is listed but greyed (no engine method).",
    "different")
add("sidebar-show-more-kids", "sidebar", "Show N more",
    "Expands the rest of a parent's child conversations.",
    "window/src/shell/Sidebar.tsx", "Sidebar",
    "Same: expands remaining child rows.",
    "same")
add("sidebar-projects", "sidebar", "Projects",
    "Toggles the projects fold and opens a project view.",
    "window/src/shell/Projects.tsx", "ProjectsSection",
    "Folds projects and lists their conversations. Opening a project is a conversation filter, not a separate project screen.",
    "different")
add("sidebar-place-overview", "sidebar", "Overview",
    "Navigates to the Overview place.",
    "window/src/places/overview/index.tsx", "OverviewPlace",
    "Navigates to Overview.",
    "same")
add("sidebar-place-canopy", "sidebar", "Canopy",
    "Later preview passes add Canopy as a place (runs from above).",
    "window/src/places/canopy/index.tsx", "CanopyPlace",
    "Navigates to Canopy. Early preview chrome listed Overview without Canopy; current preview and app both have it.",
    "same")
add("sidebar-place-inbox", "sidebar", "Inbox",
    "Navigates to Inbox (Needs you).",
    "window/src/places/inbox/index.tsx", "InboxPlace",
    "Navigates to Inbox.",
    "same")
add("sidebar-place-automations", "sidebar", "Automations",
    "Navigates to Automations (Scheduled).",
    "window/src/places/automations/index.tsx", "AutomationsPlace",
    "Navigates to Automations.",
    "same")
add("sidebar-place-library", "sidebar", "Library",
    "Navigates to Library (Memory).",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Navigates to Library.",
    "same")
add("sidebar-place-people", "sidebar", "People",
    "Navigates to People / team.",
    "window/src/places/people/index.tsx", "PeoplePlace",
    "Navigates to People.",
    "same")
add("sidebar-place-customize", "sidebar", "Customize",
    "Navigates to Customize (Trunks).",
    "window/src/places/customize/index.tsx", "CustomizePlace",
    "Navigates to Customize.",
    "same")
add("sidebar-person", "sidebar", "Owner",
    "Opens the person / owner menu.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Opens the person menu.",
    "same")
add("sidebar-update-chip", "sidebar", "Update chip",
    "On the person row, a copper Update chip opens the update menu.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Update to Branch <version> is a person-menu row, not a chip on the sidebar row.",
    "missing")
add("sidebar-hide-list", "sidebar", "Hide or show the list",
    "Ctrl B toggles the sidebar.",
    "window/src/shell/TopBar.tsx", "TopBar list-toggle",
    "Same shortcut and a top-bar button (Ctrl+B).",
    "same")

# ---------- chat header ----------
add("chat-show-conversations", "chat-header", "Show conversations",
    "On a narrow window, opens the sliding sidebar.",
    "window/src/shell/WindowShell.tsx", "WindowShell slide",
    "Narrow layout slides the list over. No menu-only hamburger in the wide header.",
    "same")
add("chat-header-face", "chat-header", "Trunk face",
    "Decorative in early preview; later opens the character / profile.",
    "window/src/shell/TopBar.tsx", "HeaderFace",
    "Opens the Trunk profile (or shows/hides the character panel).",
    "same")
add("chat-header-name", "chat-header", "Conversation name",
    "Shows the name; rename replaces it with an input (Enter saves, Esc cancels).",
    "window/src/shell/TopBar.tsx", "HeadName",
    "Click opens the Trunk profile. Rename uses the same in-header field.",
    "different")
add("chat-computer-view", "chat-header", "Computer view",
    "Toggles the side panel on the Computer tab.",
    "window/src/shell/WindowShell.tsx", "conversationTools",
    "Opens Computer full-size / the Computer pane, not only a pressed icon in the header.",
    "different")
add("chat-side-panel", "chat-header", "Side panel",
    "Toggles the side panel on Activity (or closes it if already a non-computer pane).",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Toggles the side panel (Ctrl Shift K). Header uses conversation ⋯ › Side panel more than a dedicated icon.",
    "different")
add("chat-more", "chat-header", "More for <name>",
    "Opens the conversation ⋯ menu.",
    "window/src/shell/ConversationMenu.tsx", "ConversationMenu",
    "Opens the conversation ⋯ menu.",
    "same")
add("chat-back", "chat-header", "Back",
    "Not in the early preview header.",
    "window/src/shell/TopBar.tsx", "TopBar",
    "History back. Preview has no back/forward in the chat header.",
    "extra")
add("chat-forward", "chat-header", "Forward",
    "Not in the early preview header.",
    "window/src/shell/TopBar.tsx", "TopBar",
    "History forward.",
    "extra")
add("lock-banner-off", "chat-header", "Turn it off",
    "Turns Lockdown off from the red banner.",
    "window/src/shell/LockdownBanner.tsx", "LockdownBanner",
    "Turns Lockdown off.",
    "same")
add("teach-stop", "chat-header", "I'm done, save it",
    "Stops teach mode and saves a procedure under Automations › Procedures.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Show it how, once is listed and greyed: needs an engine method.",
    "different")
add("call-mute", "chat-header", "Mute",
    "Toasts that the Trunk can't hear you.",
    "window/src/composer/VoiceParts.tsx", "VoiceParts",
    "Live call has real mute/camera controls, not a toast-only Mute on a header bar.",
    "different")
add("call-pause", "chat-header", "Pause",
    "Toasts Paused.",
    "window/src/composer/VoiceParts.tsx",
    "VoiceScreen",
    "No header call Pause button. Live voice is a composer overlay.",
    "missing")
add("call-end", "chat-header", "End",
    "Ends the talk-out-loud call and toasts that a transcript is in Files.",
    "window/src/composer/VoiceParts.tsx", "VoiceParts",
    "Ends the live voice session.",
    "same")

# ---------- composer ----------
add("composer-plus", "composer", "Add",
    "Opens the + menu (attach, mention, skills, temporary, check with me, thinking).",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Opens the + menu. Extra rows exist; some are greyed with a reason.",
    "same")
add("composer-dictate", "composer", "Dictate",
    "Replaces the textarea with a listening bar.",
    "window/src/composer/Composer.tsx", "Composer",
    "Starts dictation when voice is on; otherwise disabled with a Settings › Voice reason.",
    "same")
add("composer-dictate-done", "composer", "Done",
    "Leaves dictation and focuses the message box.",
    "window/src/composer/Composer.tsx", "Composer",
    "Stops dictation.",
    "same")
add("composer-send", "composer", "Send",
    "Sends the draft. If empty and a Trunk is working, the same control is Stop.",
    "window/src/composer/Composer.tsx", "Composer",
    "Sends the draft; becomes Stop while a run is active and the box is empty.",
    "same")
add("composer-stop", "composer", "Stop",
    "Stops the current run and posts a Stopped line.",
    "window/src/composer/Composer.tsx", "Composer",
    "Stops the current run (also Ctrl Shift S).",
    "same")
add("composer-enter", "composer", "Enter in message box",
    "Sends (Shift+Enter inserts a newline). If a mention/slash menu is open, accepts the first item.",
    "window/src/composer/Composer.tsx", "Composer",
    "Same send / newline / mention accept behaviour.",
    "same")
add("composer-mention-trigger", "composer", "@",
    "Typing @ opens the mention popover.",
    "window/src/composer/mention.ts", "mention",
    "Opens mention suggestions.",
    "same")
add("composer-slash-trigger", "composer", "/",
    "Typing / opens the skills popover.",
    "window/src/composer/slash.ts", "slash",
    "Opens slash/skill suggestions.",
    "same")
add("composer-model-chip", "composer", "Model chip",
    "Later preview: a model/access/usage chip opens the model menu.",
    "window/src/composer/Composer.tsx", "Composer model chip",
    "Opens model, access and usage.",
    "same")
add("composer-talk-live", "composer", "Talk live with voice",
    "Preview talk-out-loud is on the conversation ⋯ menu (Talk out loud).",
    "window/src/composer/Composer.tsx", "Composer",
    "Starts a live voice session from a composer icon (Ctrl Shift V).",
    "different")
add("composer-dont-reply", "composer", "Don't reply",
    "Clears an in-progress reply target.",
    "window/src/composer/Composer.tsx", "Composer",
    "Clears the reply target.",
    "same")
add("empty-sugg-tidy", "composer", "Tidy my Downloads folder",
    "Fills the draft with the chip text and sends.",
    "window/src/thread/Thread.tsx", "suggestion-row",
    "Suggested replies insert/send. Empty-chat chips in the preview are four fixed demos; the app uses live suggestions.",
    "different")
add("empty-sugg-flight", "composer", "Find a cheap refundable flight to Lisbon in March",
    "Fills the draft and sends.",
    "window/src/thread/Thread.tsx", "suggestion-row",
    "Live suggestions, not this fixed chip.",
    "different")
add("empty-sugg-pdfs", "composer", "Summarise the PDFs on my desktop",
    "Fills the draft and sends.",
    "window/src/thread/Thread.tsx", "suggestion-row",
    "Live suggestions, not this fixed chip.",
    "different")
add("empty-sugg-week", "composer", "Plan my week from my calendar",
    "Fills the draft and sends.",
    "window/src/thread/Thread.tsx", "suggestion-row",
    "Live suggestions, not this fixed chip.",
    "different")
add("empty-ask-trunk", "composer", "Ask <Trunk>",
    "Opens that Trunk's conversation from the empty-chat row.",
    "window/src/shell/new-menu.ts", "newMenuItems",
    "New conversation › with <Trunk> starts a conversation. Empty chat does not list Trunk faces.",
    "different")

# ---------- plus menu ----------
add("plus-attach", "plus-menu", "Attach files",
    "Opens a file picker (later attachB18).",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Opens the file picker.",
    "same")
add("plus-folder", "plus-menu", "Add a folder",
    "Adds a folder to the draft.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Adds a folder.",
    "same")
add("plus-screenshot", "plus-menu", "Take a screenshot",
    "Disabled in the preview with a note that the Branch app can capture.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Disabled: screen capture needs the desktop app.",
    "same")
add("plus-mention", "plus-menu", "Mention a Trunk",
    "Inserts @ and opens the mention popover.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Inserts @.",
    "same")
add("plus-skill", "plus-menu", "Use a skill",
    "Inserts / and opens the skills popover.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Inserts /.",
    "same")
add("plus-temporary", "plus-menu", "Temporary conversation",
    "Toggles temporary on the current conversation (unsaved, not remembered).",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Starts a new temporary conversation when the engine supports incognito create; otherwise greyed. Does not flip the open conversation.",
    "different")
add("plus-check-with-me", "plus-menu", "Check with me",
    "Toggles ask-questions-first on this conversation.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Greyed: the engine has no ask-questions-first switch.",
    "different")
add("plus-think-quick", "plus-menu", "Quick",
    "Sets thinking to Quick and keeps the + menu open.",
    "window/src/composer/Composer.tsx", "model chip",
    "Thinking depth lives on the model chip, not as Quick/Normal/Deep in +.",
    "different")
add("plus-think-normal", "plus-menu", "Normal",
    "Sets thinking to Normal.",
    "window/src/composer/Composer.tsx", "model chip",
    "Thinking is on the model chip.",
    "different")
add("plus-think-deep", "plus-menu", "Deep",
    "Sets thinking to Deep.",
    "window/src/composer/Composer.tsx", "model chip",
    "Thinking is on the model chip.",
    "different")
add("plus-who-answers", "plus-menu", "Whoever fits",
    "In a room, picks who answers (Whoever fits / Scout / Ledger).",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Who answers here lists Trunks; the conversation's Trunk is often fixed after the first message.",
    "different")
add("plus-google-drive", "plus-menu", "From Google Drive",
    "Not in the early + menu.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Listed and greyed: Google's picker opens in the desktop app.",
    "extra")
add("plus-onedrive", "plus-menu", "From OneDrive or SharePoint",
    "Not in the early + menu.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Listed and greyed.",
    "extra")
add("plus-photo", "plus-menu", "Take a photo",
    "Later preview adds a photo capture row.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Opens the photo dialog.",
    "same")
add("plus-voice-note", "plus-menu", "Record a voice note",
    "Later preview / Settings › Voice.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Records when the microphone is on; otherwise greyed.",
    "same")
add("plus-saved-prompts", "plus-menu", "Saved prompts",
    "Later preview has a prompts picker.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Greyed: engine keeps no saved prompts.",
    "different")
add("plus-goal", "plus-menu", "Set a goal",
    "Inserts /goal.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Inserts /goal.",
    "same")
add("plus-picture", "plus-menu", "Make a picture",
    "Opens the make-a-picture dialog.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Opens Make a picture when a model is connected; otherwise greyed.",
    "same")
add("plus-office-doc", "plus-menu", "Write a document, spreadsheet or slides",
    "Later preview office-make row.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Greyed: no document command.",
    "different")
add("plus-gif", "plus-menu", "Find a GIF…",
    "Later preview GIF search.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Greyed: no GIF search.",
    "different")
add("plus-improve", "plus-menu", "Improve my draft",
    "Later preview rewrite-draft.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Greyed: can't rewrite without sending.",
    "different")
add("plus-background", "plus-menu", "Run it in the background",
    "Inserts /bg.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Inserts /bg.",
    "same")
add("plus-phone-call", "plus-menu", "Phone call…",
    "Later preview phone-call row.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Greyed; click goes to Settings › Voice.",
    "different")
add("plus-meeting", "plus-menu", "Join a meeting…",
    "Later preview meeting row.",
    "window/src/composer/PlusMenu.tsx", "PlusMenu",
    "Greyed; click goes to Settings › Voice.",
    "different")

# ---------- new menu ----------
add("new-conversation", "new-menu", "New conversation",
    "Creates a new conversation with Sapling (Ctrl N).",
    "window/src/shell/new-menu.ts", "newMenuItems",
    "Submenu: New conversation with each Trunk (default marked). Ctrl N still starts one.",
    "different")
add("new-trunk", "new-menu", "New Trunk",
    "Opens the New Trunk setup conversation.",
    "window/src/shell/new-menu.ts", "newMenuItems",
    "Starts New Trunk setup.",
    "same")
add("new-group", "new-menu", "New group chat",
    "Opens the new group chat flow (people, Trunks, agents).",
    "window/src/rooms/NewGroupChat.tsx", "openNewGroupChat",
    "Opens the new group chat dialog.",
    "same")
add("new-automation", "new-menu", "New automation",
    "Goes to Automations › Scheduled.",
    "window/src/shell/new-menu.ts", "newMenuItems",
    "Opens Automations (Scheduled).",
    "same")
add("new-from-job", "new-menu", "A Trunk from a job…",
    "Goes to Customize › Trunks (job templates).",
    "window/src/shell/new-menu.ts", "newMenuItems",
    "Opens Customize.",
    "same")
add("new-make-trunk", "new-menu", "Have Branch make a Trunk",
    "Opens a dialog; Propose it posts a make-Trunk card in the Branch conversation.",
    "window/src/shell/new-menu.ts", "newMenuItems",
    "Runs the make-Trunk flow.",
    "same")
add("new-quick-ask", "new-menu", "Quick ask",
    "Later preview: Quick ask overlay (Ctrl Shift Space).",
    "window/src/shell/QuickAsk.tsx", "QuickAsk",
    "Opens Quick ask.",
    "same")

# ---------- person menu ----------
add("person-look-light", "person-menu", "Light",
    "Sets the light theme.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Sets Light.",
    "same")
add("person-look-dark", "person-menu", "Dark",
    "Sets the dark theme.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Sets Dark.",
    "same")
add("person-look-auto", "person-menu", "Auto",
    "Follows the computer theme.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Sets Auto / system.",
    "same")
add("person-switch", "person-menu", "Switch person",
    "Cycles the demo person (Owner ↔ Guest) and toasts.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "No Switch person row. Add opens inviting another person.",
    "missing")
add("person-add", "person-menu", "Add",
    "Not in the early owner menu (Invite lives in Settings › People).",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Add person.",
    "extra")
add("person-settings", "person-menu", "Settings",
    "Opens Settings (Ctrl ,).",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Opens Settings.",
    "same")
add("person-achievements", "person-menu", "Achievements",
    "Later owner menu: opens Settings › Achievements.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Opens Settings › Achievements.",
    "same")
add("person-shortcuts", "person-menu", "Keyboard shortcuts",
    "Opens the shortcuts dialog (?).",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Opens the shortcuts dialog.",
    "same")
add("person-help", "person-menu", "Help and design notes",
    "Toggles the prototype Guide/notes layer.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Guide opens the product Guide menu, not design-critique pins.",
    "different")
add("person-apps", "person-menu", "Get the apps",
    "Later owner menu: Get the apps sheet.",
    "window/src/shell/GetApps.tsx", "GetApps",
    "Opens Get the apps.",
    "same")
add("person-update", "person-menu", "Update to 0.20.0",
    "Goes to Settings › Updates.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Goes to Settings › Updates when an update is waiting.",
    "same")
add("person-about", "person-menu", "About Branch",
    "Opens the About dialog (demo version line).",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Opens About Branch with the real version.",
    "same")
add("person-replay", "person-menu", "Replay the first run",
    "Replays the first-run / setup flow.",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Label is Set up Branch; opens setup, not a design-preview first-run slideshow.",
    "different")
add("person-lock", "person-menu", "Lock Branch",
    "Shows the lock screen (PIN demo).",
    "window/src/shell/PersonMenu.tsx", "PersonMenu",
    "Locks; with no PIN it opens Settings › Permissions › App lock.",
    "same")

# ---------- conversation menu ----------
add("cmenu-pin", "conversation-menu", "Pin to top",
    "Pins or unpins the conversation.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Pins or unpins.",
    "same")
add("cmenu-pause", "conversation-menu", "Pause this Trunk",
    "Pauses the Trunk so it won't start anything new.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Listed and greyed: pausing needs an engine method.",
    "different")
add("cmenu-rename", "conversation-menu", "Rename",
    "Puts the header name in an edit field.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Renames the thread or opens Edit Trunk for the default Trunk.",
    "same")
add("cmenu-edit", "conversation-menu", "Edit Trunk…",
    "Opens the Edit Trunk dialog (look + what it may do).",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Opens the Trunk editor / People profile edit.",
    "same")
add("cmenu-teach", "conversation-menu", "Show it how, once",
    "Starts teach mode on that Trunk.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Listed and greyed.",
    "different")
add("cmenu-talk", "conversation-menu", "Talk out loud",
    "Starts a talk-out-loud header bar.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Talk live; greyed when voice is off.",
    "same")
add("cmenu-inspect", "conversation-menu", "Look inside the last reply",
    "Opens the inspect / look-inside view of the last reply.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Looks inside the last reply; greyed if there is no reply.",
    "same")
add("cmenu-export", "conversation-menu", "Export conversation",
    "Toasts that it saved Markdown to Library › Documents.",
    "window/src/transcript-export/ExportDialog.tsx", "ExportDialog",
    "Opens Export (Markdown, HTML, HTML replay). Not a toast-only save.",
    "different")
add("cmenu-remove", "conversation-menu", "Remove Trunk…",
    "Opens a confirm dialog; Remove archives for 30 days.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Remove <Trunk>… when more than one Trunk exists.",
    "same")
add("cmenu-room-add", "conversation-menu", "Add a Trunk to this room",
    "Toasts pick-a-Trunk (stub).",
    "window/src/rooms/room-menu.ts", "room menu",
    "Room menu has real add/rename/leave rows where the engine supports them.",
    "different")
add("cmenu-room-rename", "conversation-menu", "Rename room",
    "Renames the room.",
    "window/src/rooms/room-menu.ts", "room menu",
    "Rename this group…",
    "same")
add("cmenu-room-rules", "conversation-menu", "Room rules",
    "Toasts a stub about who answers first.",
    "window/src/rooms/room-menu.ts", "room menu",
    "Room rules exist as real rows when the engine has them; not a toast.",
    "different")
add("cmenu-room-leave", "conversation-menu", "Leave and archive",
    "Toasts Archived. Find it in search.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Archive / leave is a real engine action, not a toast.",
    "different")
add("cmenu-search", "conversation-menu", "Search in this conversation",
    "Later preview Find in conversation (Ctrl F).",
    "window/src/thread/FindBar.tsx", "FindBar",
    "Opens find in this conversation (Ctrl F).",
    "same")
add("cmenu-side-panel", "conversation-menu", "Side panel",
    "Toggles the side panel.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Toggles the side panel (Ctrl Shift K).",
    "same")
add("cmenu-list", "conversation-menu", "Hide or show the list",
    "Toggles the sidebar (Ctrl B).",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Toggles the list (Ctrl B).",
    "same")
add("cmenu-own-window", "conversation-menu", "Open in its own window",
    "Later preview own-window.",
    "window/src/shell/own-window.ts", "ownWindow",
    "Opens the conversation in its own window when the desktop app allows it.",
    "same")
add("cmenu-computer", "conversation-menu", "Open its computer",
    "Opens Computer full size.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Opens Computer.",
    "same")
add("cmenu-browser", "conversation-menu", "Open the browser",
    "Opens Browser full size.",
    "window/src/shell/conversation-menu.ts", "conversationMenuItems",
    "Opens the browser stage.",
    "same")

# ---------- machines / mode / model / room / spend / update menus ----------
add("machines-this", "machines-menu", "This computer",
    "Selects this computer as the assistant host.",
    "window/src/shell/MachineMenu.tsx", "MachineMenu",
    "Selects this computer.",
    "same")
add("machines-other", "machines-menu", "Other computer row",
    "Switches to that machine and toasts Now talking to the assistant on <name>. Offline rows are disabled.",
    "window/src/shell/MachineMenu.tsx", "MachineMenu",
    "Switches the gateway target when the engine knows another computer.",
    "same")
add("machines-add", "machines-menu", "Add a computer…",
    "Toasts: open Branch on the other computer and scan the code.",
    "window/src/shell/WindowShell.tsx", "AddComputer",
    "Opens the Add a computer dialog (pairing), not a toast.",
    "different")
add("mode-ask-everything", "mode-menu", "Ask for everything",
    "Sets approval mode to ask every step.",
    "window/src/composer/mode.ts", "mode menu / Settings › Permissions",
    "Sets the exec mode when the engine supports it.",
    "same")
add("mode-ask-first", "mode-menu", "Ask first",
    "Sets Ask first (default).",
    "window/src/composer/mode.ts", "mode menu",
    "Sets Ask first.",
    "same")
add("mode-just-do-it", "mode-menu", "Just do it",
    "Sets Just do it; Lockdown still stops it.",
    "window/src/composer/mode.ts", "mode menu",
    "Sets full-access / just-do-it when the engine allows it.",
    "same")
add("mode-scope-here", "mode-menu", "This conversation",
    "Applies the mode only to this conversation.",
    "window/src/composer/mode.ts", "mode menu",
    "Per-conversation mode when the engine has it.",
    "same")
add("mode-scope-everywhere", "mode-menu", "Everywhere",
    "Applies the mode everywhere.",
    "window/src/composer/mode.ts", "mode menu",
    "Global mode.",
    "same")
add("mode-lockdown", "mode-menu", "Lockdown",
    "Toggles Lockdown.",
    "window/src/shell/use-lockdown.ts", "useLockdown",
    "Toggles Lockdown.",
    "same")
add("mode-all-permissions", "mode-menu", "All permissions…",
    "Opens Settings › Permissions.",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Opens Settings › Permissions.",
    "same")
add("model-local", "model-menu", "Qwen3.6 35B",
    "Selects the on-this-computer model (demo).",
    "window/src/composer/model.ts", "model menu",
    "Selects a connected model; labels come from the engine, not the demo name.",
    "same")
add("model-chatgpt", "model-menu", "Your ChatGPT account",
    "Toasts that ChatGPT answers from now on.",
    "window/src/composer/model.ts", "model menu",
    "Selects that account's model.",
    "same")
add("model-claude", "model-menu", "Your Claude account",
    "Toasts that Claude answers from now on.",
    "window/src/composer/model.ts", "model menu",
    "Selects that account's model.",
    "same")
add("model-second-opinion", "model-menu", "Second opinion on hard questions",
    "Toggles a demo second-opinion switch (plain toast).",
    "window/src/places/settings/set1/models.tsx", "ModelsPage",
    "Second opinion is a Settings › Models control, not a status-bar menu switch.",
    "different")
add("model-manage", "model-menu", "Manage models…",
    "Opens Settings › Models.",
    "window/src/places/settings/set1/models.tsx", "ModelsPage",
    "Opens Settings › Models.",
    "same")
add("room-tidy", "room-menu", "Tidy up this conversation",
    "Toasts Older parts summarised. 94% free.",
    "window/src/shell/StatusPopovers.tsx", "StatusPopover room",
    "Context / room-left popover. Tidy is not a toast-only stub when compaction exists; otherwise unknown.",
    "unknown")
add("spend-usage", "spend-menu", "Data & usage…",
    "Opens Settings › Data & usage.",
    "window/src/places/settings/set2/usage.tsx", "Usage page",
    "Status usage ring opens every-account usage; Settings › Data & usage is the full page.",
    "same")
add("update-install", "update-menu", "Install when nothing is running",
    "Toasts that 0.20.0 will install, with Undo that cancels.",
    "window/src/connect/desktop-component-updates.ts", "desktop component updates",
    "Applies the waiting update through the desktop updater, not a demo toast.",
    "different")
add("update-remind", "update-menu", "Remind me tomorrow",
    "Closes the popover and toasts We’ll remind you tomorrow.",
    "window/src/shell/StatusPopovers.tsx", "version / update popover",
    "Remind tomorrow is a real preference when an update is waiting.",
    "same")

# ---------- status bar ----------
add("status-connection", "status-bar", "Connected · this computer",
    "Opens the machines menu.",
    "window/src/shell/StatusBar.tsx", "StatusBar",
    "Opens the connection popover (machine + gateway), not only the machines menu.",
    "different")
add("status-mode", "status-bar", "Ask first",
    "Opens the how-much-may-Trunks-do menu.",
    "window/src/shell/StatusExtras.tsx", "StatusLeftExtras",
    "Mode/Lockdown is a status extra, not always a dedicated Ask first chip.",
    "different")
add("status-model", "status-bar", "Qwen3.6 35B · this computer",
    "Opens the model menu.",
    "window/src/composer/Composer.tsx", "Composer model chip",
    "Model lives on the composer chip, not a status-bar model button.",
    "different")
add("status-room", "status-bar", "Room left 86%",
    "Opens the room-left popover.",
    "window/src/shell/StatusBar.tsx", "StatusBar",
    "Opens the context-left popover.",
    "same")
add("status-spend", "status-bar", "Today $0.00",
    "Opens the spend popover.",
    "window/src/shell/StatusBar.tsx", "StatusBar usage",
    "Usage ring opens every-account usage (hover expands). Not a Today $0.00 text chip.",
    "different")
add("status-pet", "status-bar", "Acorn companion",
    "Cycles a tip toast while any Trunk works.",
    "window/src/shell/SidebarPet.tsx", "SidebarPet",
    "The acorn lives at the foot of the list (and can sit in status extras). Click still reacts / tips.",
    "different")
add("status-version", "status-bar", "0.19.4",
    "Opens the update menu.",
    "window/src/shell/StatusBar.tsx", "StatusBar",
    "Opens the version / update popover with the real version.",
    "same")
add("status-running", "status-bar", "Nothing running",
    "Later preview running indicator.",
    "window/src/shell/StatusBar.tsx", "StatusBar",
    "Opens the running popover.",
    "same")
add("status-gateway", "status-bar", "Gateway",
    "Later preview gateway chip.",
    "window/src/shell/StatusBar.tsx", "StatusBar",
    "Opens the gateway popover.",
    "same")

# ---------- side pane ----------
add("pane-tab-computer", "side-pane", "Computer",
    "Shows the Computer pane tab.",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Computer is a full-size stage and/or a pane tab, depending on layout.",
    "different")
add("pane-tab-activity", "side-pane", "Activity",
    "Shows Activity (tool steps).",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Shows Activity.",
    "same")
add("pane-tab-plan", "side-pane", "Plan",
    "Shows the plan.",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Plan is in the thread and/or pane; tab set differs (Activity, Files, Memory, Terminal, Side chat, …).",
    "different")
add("pane-tab-files", "side-pane", "Files",
    "Shows files touched in this conversation.",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Shows Files (Ctrl Shift B).",
    "same")
add("pane-tab-memory", "side-pane", "Memory",
    "Shows memories used here.",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Shows Memory.",
    "same")
add("pane-tab-terminal", "side-pane", "Terminal",
    "Shows a read-only terminal log.",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Shows Terminal (Ctrl `).",
    "same")
add("pane-close", "side-pane", "Close panel",
    "Closes the side panel.",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Closes the panel.",
    "same")
add("pane-add-tab", "side-pane", "Add a tab",
    "Later preview + Add a tab.",
    "window/src/stage/SidePane.tsx", "SidePane",
    "Opens Add a tab (Side chat, Changes, …; later tabs greyed).",
    "same")
add("pane-file-open", "side-pane", "File row",
    "Opens that file (fileOpen).",
    "window/src/stage/SidePane.tsx", "Files tab",
    "Opens or previews the file.",
    "same")
add("pane-memory-forget", "side-pane", "Forget",
    "Toasts Forgotten. It won’t use this again.",
    "window/src/places/library/memory.tsx", "MemoryTab",
    "Forget is a Library / memory action, not only a pane toast.",
    "different")
add("pane-takeover", "side-pane", "Take over",
    "Gives you the mouse; Scout pauses.",
    "window/src/thread/ComputerActivityCard.tsx", "ComputerActivityCard",
    "Take over / open computer full size. Exact handoff is the stage, not only the pane.",
    "same")
add("pane-handback", "side-pane", "Hand back",
    "Returns control to Scout.",
    "window/src/thread/ComputerActivityCard.tsx", "ComputerActivityCard",
    "Hands back / continues the computer run.",
    "same")

# ---------- thread cards ----------
add("msg-edit", "thread", "Edit",
    "Edits the user message (rewind / rewrite).",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Edits the user message when the engine allows it.",
    "same")
add("msg-branch", "thread", "Branch from here",
    "Toasts: Starts a new conversation from this point.",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Branches when the engine supports it; otherwise greyed. Not toast-only.",
    "different")
add("msg-copy", "thread", "Copy",
    "Copies the reply.",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Copies the message.",
    "same")
add("msg-retry", "thread", "Try again",
    "Retries the last reply.",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Retries the reply.",
    "same")
add("msg-inspect", "thread", "Look inside",
    "Opens look-inside for that reply.",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Looks inside when available.",
    "same")
add("msg-flag", "thread", "Report a problem",
    "Opens the flag dialog.",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Greyed: you can't flag replies here yet.",
    "different")
add("msg-reply", "thread", "Reply",
    "Later hover bar: reply to this message.",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Sets the composer reply target.",
    "same")
add("msg-react", "thread", "React",
    "Later hover bar: emoji reactions.",
    "window/src/thread/HoverBar.tsx", "HoverBar",
    "Adds a reaction.",
    "same")
add("thread-steps", "thread", "Tool steps summary",
    "Expands/collapses the folded step list.",
    "window/src/thread/blocks.tsx", "step details",
    "Expands/collapses steps.",
    "same")
add("thread-takeover", "thread", "Take over",
    "Takes the computer; Scout pauses.",
    "window/src/thread/ComputerActivityCard.tsx", "ComputerActivityCard",
    "Opens/takes the computer.",
    "same")
add("thread-watch-pane", "thread", "Watch in the side panel",
    "Opens the Computer pane.",
    "window/src/thread/ComputerActivityCard.tsx", "ComputerActivityCard",
    "Opens computer full size / the stage; wording differs.",
    "different")
add("thread-handback", "thread", "Hand back to Scout",
    "Returns control to Scout.",
    "window/src/thread/ComputerActivityCard.tsx", "ComputerActivityCard",
    "Hands back / continues.",
    "same")
add("thread-ask-send", "thread", "Send it",
    "Allows the pending email/action.",
    "window/src/thread/ApprovalCard.tsx", "ApprovalCard",
    "Allows the pending approval.",
    "same")
add("thread-ask-always", "thread", "Always allow for Ledger",
    "Allows and remembers for that Trunk.",
    "window/src/thread/ApprovalCard.tsx", "ApprovalCard",
    "Always-allow when the engine has a trust/always path.",
    "same")
add("thread-ask-dont", "thread", "Don't send",
    "Denies the pending action.",
    "window/src/thread/ApprovalCard.tsx", "ApprovalCard",
    "Denies the approval.",
    "same")
add("thread-choice", "thread", "Choice option (A–E)",
    "Picks a setup/choice option and continues the conversation.",
    "window/src/thread/QuestionCard.tsx", "QuestionCard",
    "Picks an option.",
    "same")
add("thread-choice-own", "thread", "Reply",
    "Submits a typed own answer on a choice card.",
    "window/src/thread/QuestionCard.tsx", "QuestionCard",
    "Submits the typed answer.",
    "same")
add("thread-file-open", "thread", "File card",
    "Navigates to Library › Made for you.",
    "window/src/thread/blocks.tsx", "file / files-changed",
    "Opens the file or Files pane, not always Library.",
    "different")
add("thread-art-larger", "thread", "Open larger",
    "Opens the chart in a wide dialog.",
    "window/src/thread/MdImage.tsx", "picture / art",
    "Opens a larger view when the block supports it.",
    "same")
add("thread-art-copy", "thread", "Copy code",
    "Copies the chart code.",
    "window/src/thread/CodeBlock.tsx", "CodeBlock",
    "Copies code.",
    "same")
add("thread-art-save", "thread", "Save to Library",
    "Saves the chart to Library.",
    "window/src/places/library/index.tsx", "Library",
    "Save-to-Library on made artifacts when the engine supports it.",
    "unknown")
add("thread-ckpt-undo", "thread", "Put it all back",
    "Restores the checkpoint (with toast Undo).",
    "window/src/thread/blocks.tsx", "checkpoint / files-changed",
    "Checkpoint restore when the engine exposes it.",
    "unknown")
add("thread-mem-keep", "thread", "Remember",
    "Keeps the suggested memory.",
    "window/src/places/library/memory.tsx", "MemoryTab",
    "Memory keep/forget is in Library; a thread card may also offer it.",
    "same")
add("thread-mem-forget", "thread", "Don't",
    "Rejects the suggested memory.",
    "window/src/places/library/memory.tsx", "MemoryTab",
    "Rejects the memory.",
    "same")
add("thread-suggest-yes", "thread", "Every Friday at 5 PM",
    "Adds a scheduled automation and toasts.",
    "window/src/places/automations/Proposal.tsx", "Proposal",
    "Accepts an automation proposal.",
    "same")
add("thread-suggest-no", "thread", "Not now",
    "Dismisses the routine offer.",
    "window/src/places/automations/Proposal.tsx", "Proposal",
    "Dismisses the proposal.",
    "same")
add("thread-to-latest", "thread", "Scroll to latest",
    "Jumps to the latest message.",
    "window/src/thread/Thread.tsx", "Thread",
    "Scrolls to latest.",
    "same")
add("thread-find-prev", "thread", "Previous",
    "Find previous match (Ctrl F).",
    "window/src/thread/FindBar.tsx", "FindBar",
    "Previous match.",
    "same")
add("thread-find-next", "thread", "Next",
    "Find next match.",
    "window/src/thread/FindBar.tsx", "FindBar",
    "Next match.",
    "same")
add("thread-plan-refresh", "thread", "Refresh",
    "Later plan card refresh.",
    "window/src/thread/PlanCard.tsx", "PlanCard",
    "Refreshes the plan.",
    "same")
add("thread-error-dismiss", "thread", "Dismiss",
    "Dismisses a run-error strip.",
    "window/src/thread/blocks.tsx", "run-error",
    "Dismisses the error.",
    "same")
add("thread-open-screen-control", "thread", "Open screen control",
    "Later: open screen control switch.",
    "window/src/thread/blocks.tsx", "open-screen-control",
    "Opens screen control.",
    "same")

# ---------- places: overview ----------
add("overview-grove", "overview", "Grove",
    "Later preview: opens the pixel office / grove.",
    "window/src/places/overview/index.tsx", "OverviewPlace",
    "Opens the office/grove place.",
    "same")
add("overview-pause-all", "overview", "Pause all Trunks",
    "Pauses or resumes every Trunk.",
    "window/src/places/overview/index.tsx", "OverviewPlace",
    "Listed and greyed: needs the engine's pause-all method.",
    "different")
add("overview-lockdown", "overview", "Turn Lockdown on",
    "Toggles Lockdown from Overview controls.",
    "window/src/places/overview/index.tsx", "OverviewPlace",
    "Toggles Lockdown.",
    "same")
add("overview-open-run", "overview", "Recent activity row",
    "Opens that conversation.",
    "window/src/places/overview/index.tsx", "OverviewPlace",
    "Opens the conversation.",
    "same")
add("overview-finish-setup", "overview", "Finish setup",
    "Continues first-run / setup.",
    "window/src/places/overview/Setup.tsx", "FinishSetup",
    "Opens setup.",
    "same")

# ---------- inbox ----------
add("inbox-tab-needs", "inbox", "Needs you",
    "Shows pending approvals.",
    "window/src/places/inbox/index.tsx", "InboxPlace",
    "Shows Needs you.",
    "same")
add("inbox-tab-finished", "inbox", "Finished",
    "Shows finished tasks.",
    "window/src/places/inbox/index.tsx", "InboxPlace",
    "Shows Finished.",
    "same")
add("inbox-tab-history", "inbox", "History",
    "Shows the run history with search.",
    "window/src/places/inbox/index.tsx", "InboxPlace",
    "Shows History.",
    "same")
add("inbox-tab-later", "inbox", "Later",
    "Not in the early preview inbox tabs.",
    "window/src/places/inbox/index.tsx", "InboxPlace",
    "Shows Later (snoozed).",
    "extra")
add("inbox-allow-all", "inbox", "Allow all N…",
    "Opens a confirm dialog then allows every pending item.",
    "window/src/places/inbox/NeedsYou.tsx", "NeedsYou",
    "Bulk allow when the engine supports it.",
    "same")
add("inbox-open", "inbox", "Open",
    "Opens the conversation that needs you.",
    "window/src/places/inbox/NeedsYou.tsx", "NeedsYou",
    "Opens the conversation.",
    "same")
add("inbox-allow", "inbox", "Allow",
    "Allows that pending item.",
    "window/src/places/inbox/NeedsYou.tsx", "NeedsYou",
    "Allows the item.",
    "same")
add("inbox-dont", "inbox", "Don't",
    "Denies an install/tool request.",
    "window/src/places/inbox/NeedsYou.tsx", "NeedsYou",
    "Denies the item.",
    "same")
add("inbox-watch-again", "inbox", "Watch again",
    "Toasts: Plays the task back step by step.",
    "window/src/places/inbox/History.tsx", "History",
    "Replay/open the run when the engine has it; not a toast-only stub.",
    "different")
add("inbox-mark-all-read", "inbox", "Mark all read",
    "Later preview / list action.",
    "window/src/places/inbox/index.tsx", "InboxPlace",
    "Marks all Inbox items read.",
    "same")
add("inbox-bell", "inbox", "Notices bell",
    "Later preview notices.",
    "window/src/places/inbox/Bell.tsx", "NoticesBell",
    "Opens notices.",
    "same")
add("place-settings-gear", "places", "Settings",
    "Place header gear opens Settings.",
    "window/src/shell/TopBar.tsx", "TopBar",
    "Opens Settings.",
    "same")
add("place-ask-default", "places", "Ask <default Trunk>",
    "Later preview: talk beside the place.",
    "window/src/shell/TopBar.tsx", "TopBar ask",
    "Shows the default Trunk beside the page.",
    "same")

# ---------- automations ----------
add("auto-tab-scheduled", "automations", "Scheduled",
    "Shows scheduled jobs.",
    "window/src/places/automations/index.tsx", "AutomationsPlace",
    "Shows Scheduled.",
    "same")
add("auto-tab-procedures", "automations", "Procedures",
    "Shows saved procedures.",
    "window/src/places/automations/index.tsx", "AutomationsPlace",
    "Shows Procedures.",
    "same")
add("auto-tab-triggers", "automations", "Triggers",
    "Shows event triggers.",
    "window/src/places/automations/index.tsx", "AutomationsPlace",
    "Shows Triggers.",
    "same")
add("auto-tab-checkins", "automations", "Check-ins",
    "Later preview check-ins.",
    "window/src/places/automations/Checkins.tsx", "Checkins",
    "Shows Check-ins.",
    "same")
add("auto-tab-board", "automations", "Board",
    "Later preview board.",
    "window/src/places/automations/Board.tsx", "BoardTab",
    "Shows Board.",
    "same")
add("auto-add", "automations", "Add",
    "Adds a scheduled/trigger job from a natural-language line (stays off until confirmed).",
    "window/src/places/automations/Scheduled.tsx", "ScheduledTab",
    "Creates a real cron/schedule job through the engine.",
    "same")
add("auto-toggle", "automations", "<job> on or off",
    "Toggles the job and toasts on/off.",
    "window/src/places/automations/Scheduled.tsx", "ScheduledTab",
    "Enables or disables the job.",
    "same")
add("auto-run-now", "automations", "Run now",
    "Toasts Running <name>…",
    "window/src/places/automations/Scheduled.tsx", "ScheduledTab",
    "Runs the job now through the engine, not a toast-only stub.",
    "different")
add("auto-open", "automations", "Open",
    "Opens the procedure flow.",
    "window/src/places/automations/Procedures.tsx", "ProceduresTab",
    "Opens the procedure.",
    "same")
add("auto-teach", "automations", "Show a Trunk how, once",
    "Starts teach mode.",
    "window/src/places/automations/Procedures.tsx", "ProceduresTab",
    "Teach-from-watching is missing or greyed (no engine method).",
    "different")

# ---------- library ----------
add("lib-tab-memory", "library", "Memory",
    "Shows remembered items.",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Shows Memory.",
    "same")
add("lib-tab-documents", "library", "Documents",
    "Shows documents.",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Shows Documents.",
    "same")
add("lib-tab-made", "library", "Made for you",
    "Shows made artifacts.",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Shows Made for you.",
    "same")
add("lib-tab-meetings", "library", "Meetings",
    "Not in the early preview library tabs.",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Shows Meetings.",
    "extra")
add("lib-tab-logbook", "library", "Logbook",
    "Not in the early preview library tabs.",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Shows Logbook.",
    "extra")
add("lib-forget", "library", "Forget",
    "Removes a memory with Undo toast.",
    "window/src/places/library/memory.tsx", "MemoryTab",
    "Forgets the memory.",
    "same")
add("lib-write", "library", "Write a new document",
    "Toasts: Opens a blank document a Trunk can help write.",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Head actions Translate / Make pictures are greyed (engine gaps). No Clearing pill and no toast-only Write button.",
    "different")
add("lib-open", "library", "Open",
    "Toasts: Opens in its own app.",
    "window/src/places/library/documents.tsx", "DocumentsTab",
    "Opens the document when the engine can; not a toast-only stub.",
    "different")
add("lib-canvas", "library", "Canvas",
    "Later preview Clearings/canvas.",
    "window/src/places/library/index.tsx", "LibraryPlace",
    "Not shown: a greyed Clearing pill told a person nothing (DA-42). Returns once the engine can list Clearings.",
    "missing")

# ---------- customize ----------
add("cz-tab-trunks", "customize", "Trunks",
    "Shows Trunks and job templates.",
    "window/src/places/customize/index.tsx", "CustomizePlace",
    "Shows Trunks.",
    "same")
add("cz-tab-skills", "customize", "Skills",
    "Shows skill toggles.",
    "window/src/places/customize/tools.tsx", "ToolsTab",
    "Skills live under Tools, not a top-level Customize tab.",
    "different")
add("cz-tab-specialists", "customize", "Specialists",
    "Shows specialists.",
    "window/src/places/customize/specialists.tsx", "SpecialistsTab",
    "Shows Specialists.",
    "same")
add("cz-tab-plugins", "customize", "Plugins",
    "Shows plugin toggles.",
    "window/src/places/customize/tools.tsx", "ToolsTab",
    "Plugins live under Tools.",
    "different")
add("cz-tab-connections", "customize", "Connections",
    "Shows app connections.",
    "window/src/places/customize/tools.tsx", "ToolsTab",
    "Connectors live under Tools.",
    "different")
add("cz-tab-channels", "customize", "Channels",
    "Shows chat apps + pair a phone.",
    "window/src/places/customize/channels.tsx", "ChannelsTab",
    "Tab label is Chat apps.",
    "different")
add("cz-tab-everywhere", "customize", "Everywhere",
    "Later preview everywhere tab.",
    "window/src/places/customize/everywhere.tsx", "EverywhereTab",
    "Shows Everywhere.",
    "same")
add("cz-new-trunk", "customize", "A new Trunk",
    "Opens the New Trunk conversation.",
    "window/src/places/customize/trunks.tsx", "TrunksTab",
    "Starts a new Trunk.",
    "same")
add("cz-new-group", "customize", "New group chat",
    "Opens new group chat.",
    "window/src/places/customize/trunks.tsx", "TrunksTab",
    "Opens new group chat.",
    "same")
add("cz-edit-trunk", "customize", "Edit",
    "Opens Edit Trunk.",
    "window/src/places/customize/trunks.tsx", "TrunksTab",
    "Opens the Trunk editor.",
    "same")
add("cz-pause-trunk", "customize", "Pause",
    "Pauses or resumes that Trunk.",
    "window/src/places/customize/trunks.tsx", "TrunksTab",
    "Pause is missing or greyed (no engine method).",
    "different")
add("cz-job-template", "customize", "Job template tile",
    "Creates a Trunk from a job and opens its intro conversation.",
    "window/src/places/customize/jobs.tsx", "jobs",
    "Starts a Trunk from a job.",
    "same")
add("cz-channel-setup", "customize", "Set up",
    "Toasts a two-minute setup stub, or Manage if already connected.",
    "window/src/places/customize/channels.tsx", "ChannelsTab",
    "Starts the real chat-app setup / manage flow.",
    "different")
add("cz-pair-phone", "customize", "Pair a phone",
    "Opens the pair-a-phone QR dialog (demo code).",
    "window/src/places/customize/pairing.tsx", "pairing",
    "Opens device pairing.",
    "same")
add("cz-connect", "customize", "Connect",
    "Toasts sign-in-on-their-site, or Manage if connected.",
    "window/src/places/customize/connectors.tsx", "connectors",
    "Starts the connector sign-in / manage flow.",
    "different")
add("cz-skill-toggle", "customize", "Skill switch",
    "Toggles a demo skill (plain switch, no toast).",
    "window/src/places/customize/tools.tsx", "ToolsTab",
    "Toggles that tool/skill for the chosen Trunks.",
    "same")

# ---------- people place ----------
add("people-tab-live", "people", "Live now",
    "Later People place tab.",
    "window/src/places/people/index.tsx", "PeoplePlace",
    "Shows Live now.",
    "same")
add("people-tab-people", "people", "People",
    "People list tab.",
    "window/src/places/people/index.tsx", "PeoplePlace",
    "Shows People.",
    "same")
add("people-invite", "people", "Invite someone",
    "Opens the invite dialog (copy-once link).",
    "window/src/places/people/person-dialogs.tsx", "invite dialogs",
    "Invites a person.",
    "same")

# ---------- canopy / office ----------
add("canopy-tab-now", "canopy", "Now",
    "Shows live runs.",
    "window/src/places/canopy/index.tsx", "CanopyPlace",
    "Shows Now.",
    "same")
add("canopy-tab-cards", "canopy", "Cards",
    "Shows canopy cards.",
    "window/src/places/canopy/index.tsx", "CanopyPlace",
    "Shows Cards.",
    "same")
add("canopy-office-view", "canopy", "Office view",
    "Opens the pixel office.",
    "window/src/places/canopy/index.tsx", "CanopyPlace",
    "Opens the office place.",
    "same")
add("office-desk", "office", "Trunk desk",
    "Clicks a desk to open that Trunk (pixel-office.global.js).",
    "window/src/places/office/index.tsx", "OfficePlace",
    "Opens that Trunk's conversation / profile.",
    "same")

# ---------- settings nav ----------
for sid, label, dest in [
    ("general", "General", "settings-general"),
    ("people", "People", "settings-people"),
    ("appearance", "Appearance", "settings-appearance"),
    ("notifications", "Notifications", "settings-notifications"),
    ("instructions", "Instructions & personality", "settings-instructions"),
    ("models", "Models", "settings-models"),
    ("accounts", "Accounts", "settings-accounts"),
    ("voice", "Voice", "settings-voice"),
    ("permissions", "Permissions", "settings-permissions"),
    ("computer", "Computer & browser", "settings-computer"),
    ("secrets", "Saved sign-ins", "settings-secrets"),
    ("usage", "Data & usage", "settings-usage"),
    ("updates", "Updates & about", "settings-updates"),
]:
    add(f"set-nav-{sid}", "settings", label,
        f"Opens Settings › {label}.",
        "window/src/places-nav/SettingsFrame.tsx", "SettingsFrame",
        f"Opens Settings › {label}.",
        "same")

add("set-nav-local", "settings", "On this computer",
    "Later SET_NAV: opens Settings › On this computer.",
    "window/src/places/settings/set1/local.tsx", "LocalPage",
    "Opens Settings › On this computer.",
    "same")
add("set-nav-chatapps", "settings", "Chat apps",
    "Later SET_NAV: Chat apps.",
    "window/src/places/settings/pages/set2.tsx", "Chat apps page",
    "Opens Settings › Chat apps.",
    "same")
add("set-nav-gateway", "settings", "Gateway",
    "Later SET_NAV: Gateway.",
    "window/src/places/settings/set2/gateway.tsx", "Gateway page",
    "Opens Settings › Gateway.",
    "same")
add("set-nav-self", "settings", "Branch itself",
    "Later SET_NAV: Branch itself.",
    "window/src/places/settings/pages/set3.tsx", "Branch itself page",
    "Opens Settings › Branch itself.",
    "same")
add("set-nav-achievements", "settings", "Achievements",
    "Later SET_NAV: Achievements.",
    "window/src/places/settings/pages/set3.tsx", "Achievements page",
    "Opens Settings › Achievements.",
    "same")
add("set-nav-grafts", "settings", "Grafts",
    "Later SET_NAV graftsT5.",
    "window/src/places-nav/settings-nav.ts", "settingsGroups",
    "Nav id is agents, label Grafts.",
    "same")
add("set-nav-backups", "settings", "Backups",
    "Later SET_NAV backupsT5.",
    "window/src/places-nav/settings-nav.ts", "settingsGroups",
    "Opens Settings › Backups.",
    "same")
add("set-nav-seasons", "settings", "Seasons",
    "Not in the preview SET_NAV.",
    "window/src/places-nav/settings-nav.ts", "settingsGroups",
    "Opens Settings › Seasons. Preview has no Seasons page.",
    "extra")
add("set-nav-advanced", "settings", "Advanced",
    "Shown when Show everything / level is on.",
    "window/src/places-nav/SettingsFrame.tsx", "SettingsFrame",
    "Shown at Advanced or Technical level.",
    "same")
add("set-nav-developer", "settings", "Developer",
    "Shown at the highest show-everything level.",
    "window/src/places-nav/SettingsFrame.tsx", "SettingsFrame",
    "Shown at Technical level.",
    "same")
add("set-search", "settings", "Search settings",
    "Filters the settings nav as you type.",
    "window/src/places-nav/SettingsFrame.tsx", "SettingsFrame",
    "Searches settings (pages + rows).",
    "same")
add("set-show-everything", "settings", "Show everything",
    "Toggles extra pages (Advanced, Developer). Off drops those pages back to General.",
    "window/src/places-nav/SettingsFrame.tsx", "SettingsFrame",
    "Level control is a three-way Regular / Advanced / Technical segmented control, not a single checkbox.",
    "different")

# ---------- settings pages (key controls) ----------
add("set-start-with-os", "settings-general", "Start with Windows",
    "Toggles start-with-OS (demo switch toasts on/off).",
    "window/src/places/settings/set1/general.tsx", "GeneralPage",
    "Toggles start with the OS via desktop controls; greyed in a browser.",
    "same")
add("set-keep-working", "settings-general", "Keep working when the window closes",
    "Demo switch (toast).",
    "window/src/places/settings/set2/gateway.tsx", "Gateway page",
    "Keep-working / tray is on Gateway and desktop controls, not this General row.",
    "different")
add("set-project-edit", "settings-general", "Edit",
    "Toasts: Edit this project's instructions.",
    "window/src/places/settings/set1/general.tsx", "GeneralPage",
    "Edit is disabled: can't open a project's instructions from here yet.",
    "different")
add("set-shortcuts-show", "settings-general", "Show all",
    "Opens the keyboard shortcuts dialog.",
    "window/src/places/settings/set1/general.tsx", "GeneralPage",
    "Opens ShortcutsDialog.",
    "same")
add("set-people-edit", "settings-people", "Edit",
    "Toasts: Change what <person> may do.",
    "window/src/places/settings/set1/people.tsx", "PeoplePage",
    "Edits the person when the engine allows; some rows greyed.",
    "different")
add("set-people-invite", "settings-people", "Invite someone",
    "Opens the invite dialog.",
    "window/src/places/settings/set1/people.tsx", "PeoplePage",
    "Invites someone.",
    "same")
add("set-people-pin", "settings-people", "Ask for a PIN when switching person",
    "Demo switch.",
    "window/src/places/settings/set1/people.tsx", "PeoplePage",
    "App lock / PIN lives under Permissions and People; wiring differs.",
    "different")
add("set-people-separate", "settings-people", "Keep conversations separate",
    "Demo switch.",
    "window/src/places/settings/set1/people-more.tsx", "people-more",
    "Row exists; may be greyed (engine gap).",
    "different")
add("set-theme-light", "settings-appearance", "Light",
    "Sets the light theme tile.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Sets Light.",
    "same")
add("set-theme-dark", "settings-appearance", "Dark",
    "Sets the dark theme tile.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Sets Dark.",
    "same")
add("set-theme-system", "settings-appearance", "Match this computer",
    "Follows the OS theme.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Sets Auto / match this computer.",
    "same")
add("set-text-size", "settings-appearance", "Text size",
    "Sets small / Regular / large on every screen.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Sets text size.",
    "same")
add("set-pet", "settings-appearance", "Acorn companion",
    "Shows or hides the acorn.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Toggles the companion.",
    "same")
add("set-still", "settings-appearance", "Keep things still",
    "Stops working-ring / cursor / acorn motion.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Toggles reduced motion / still.",
    "same")
add("set-scenery", "settings-appearance", "Scenery behind the list",
    "Toggles the pixel oak at the foot of the list.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Toggles scenery.",
    "same")
add("set-skins", "settings-appearance", "Browse skins",
    "Opens the skin gallery.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Browse themes / skins on Appearance.",
    "same")
add("set-language", "settings-appearance", "Language",
    "Toasts that the prototype stays in English.",
    "window/src/places/settings/set1/appearance.tsx", "AppearancePage",
    "Language select exists; switching languages is real or limited — not a prototype-stays-English toast.",
    "different")
add("set-notif-need", "settings-notifications", "A Trunk needs a yes",
    "Demo notify switch.",
    "window/src/places/settings/set1/notifications.tsx", "NotificationsPage",
    "Toggles that notification.",
    "same")
add("set-notif-done", "settings-notifications", "A long task finishes",
    "Demo notify switch.",
    "window/src/places/settings/set1/notifications.tsx", "NotificationsPage",
    "Toggles that notification.",
    "same")
add("set-notif-sound", "settings-notifications", "Play a sound",
    "Demo notify switch.",
    "window/src/places/settings/set1/notifications.tsx", "NotificationsPage",
    "Toggles sound.",
    "same")
add("set-notif-days-off", "settings-notifications", "Days off",
    "Segmented Sat / Sun / None.",
    "window/src/places/settings/set1/notifications.tsx", "NotificationsPage",
    "Quiet days control.",
    "same")
add("set-file-toggle", "settings-instructions", "Read SOUL.md",
    "Demo switch for whether Trunks read that file.",
    "window/src/places/settings/set1/instructions.tsx", "InstructionsPage",
    "Toggles whether that instruction file is used.",
    "same")
add("set-file-edit", "settings-instructions", "Edit",
    "Opens the file editor dialog and Save toasts that every Trunk reads it.",
    "window/src/places/settings/set1/instructions.tsx", "InstructionsPage",
    "Edits the file through the engine.",
    "same")
add("set-models-tab", "settings-models", "Connections / Defaults / On this computer / Second opinion / Media",
    "Switches Models sub-tabs.",
    "window/src/places/settings/set1/models.tsx", "ModelsPage",
    "Models is one page with sections; On this computer is also its own nav page.",
    "different")
add("set-models-signin", "settings-models", "Sign in",
    "Toasts sign-in-on-their-site.",
    "window/src/places/settings/account-login.ts", "account login",
    "Starts the real provider sign-in.",
    "different")
add("set-models-use", "settings-models", "Use this",
    "Toasts that the local model is now the default.",
    "window/src/places/settings/set1/local.tsx", "LocalPage",
    "Selects that local model.",
    "different")
add("set-models-download", "settings-models", "Get another model",
    "Opens the download-model dialog (demo progress).",
    "window/src/places/settings/set1/local.tsx", "LocalPage",
    "Starts a local-model download through desktop/engine, not a fake progress bar.",
    "different")
add("set-voice-listen", "settings-voice", "Listening",
    "Segmented Off / Push to talk / Wake word.",
    "window/src/places/settings/pages/set2.tsx", "Voice page",
    "Sets how listening works.",
    "same")
add("set-voice-ptt", "settings-voice", "Change",
    "Toasts: Press the key you want to use.",
    "window/src/shell/ShortcutsDialog.tsx", "ShortcutsDialog",
    "Push-to-talk / Talk live keys are set in Keyboard shortcuts, not a toast.",
    "different")
add("set-voice-speak", "settings-voice", "Voice",
    "Segmented Oak / Birch / Off.",
    "window/src/places/settings/pages/set2.tsx", "Voice page",
    "Sets speak-back voice.",
    "same")
add("set-voice-dict", "settings-voice", "Dictation in the message box",
    "Demo switch.",
    "window/src/places/settings/pages/set2.tsx", "Voice page",
    "Toggles dictation.",
    "same")
add("set-perm-read", "settings-permissions", "Read files in Documents and Downloads",
    "Demo switch (toast).",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Toggles that permission through config when the engine has it.",
    "same")
add("set-perm-browse", "settings-permissions", "Use the browser on this computer",
    "Demo switch.",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Toggles browser use.",
    "same")
add("set-perm-send", "settings-permissions", "Send email and messages",
    "Demo switch.",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Toggles send permission.",
    "same")
add("set-perm-install", "settings-permissions", "Install tools and packages",
    "Demo switch.",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Toggles install permission.",
    "same")
add("set-perm-record", "settings-permissions", "Record tasks so you can watch them again",
    "Demo switch.",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Toggles recording if the engine has it; otherwise greyed.",
    "unknown")
add("set-perm-tools-when", "settings-permissions", "When tools are loaded",
    "Advanced: Never / When needed / Always.",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Tool-loading policy when shown at Advanced.",
    "same")
add("set-perm-trusted", "settings-permissions", "Add",
    "Toasts: Add a folder Trunks may change without asking.",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Trusted folders are real or greyed — not a toast-only Add.",
    "different")
add("set-perm-lockdown", "settings-permissions", "Turn Lockdown on",
    "Toggles Lockdown (danger button).",
    "window/src/places/settings/set1/permissions-top.tsx", "Permissions page",
    "Toggles Lockdown.",
    "same")
add("set-comp-scripts", "settings-computer", "Where scripts run",
    "Sealed box / This computer.",
    "window/src/places/settings/pages/set2.tsx", "Computer & browser page",
    "Sets the sandbox / where scripts run.",
    "same")
add("set-comp-screen", "settings-computer", "See the screen and use the mouse",
    "Demo switch.",
    "window/src/places/settings/pages/set2.tsx", "Computer & browser page",
    "Toggles screen control.",
    "same")
add("set-comp-browser", "settings-computer", "Which browser",
    "Branch's own / Your Chrome.",
    "window/src/places/settings/pages/set2.tsx", "Computer & browser page",
    "Sets the browser profile.",
    "same")
add("set-comp-manage", "settings-computer", "Manage",
    "Toasts Manage <computer>.",
    "window/src/places/settings/pages/set2.tsx", "Computer & browser page",
    "Manages that node/computer when the engine lists it.",
    "different")
add("set-secrets-remove", "settings-secrets", "Remove",
    "Toasts that the sign-in was removed.",
    "window/src/places/settings/pages/set2.tsx", "Saved sign-ins page",
    "Removes that fillable sign-in when the engine supports it.",
    "different")
add("set-usage-keep", "settings-usage", "Keep conversations",
    "30 days / 1 year / Forever.",
    "window/src/places/settings/set2/usage.tsx", "Usage page",
    "Sets retention.",
    "same")
add("set-usage-backup", "settings-usage", "Back up",
    "Toasts Backed up to a demo path.",
    "window/src/places/settings/pages/set3.tsx", "Backups page",
    "Back up is on Settings › Backups and runs a real backup, not a toast to a demo path.",
    "different")
add("set-usage-ckpt", "settings-usage", "See all",
    "Toasts 3 checkpoints kept this week.",
    "window/src/places/settings/set2/usage.tsx", "Usage page",
    "Lists checkpoints when the engine has them.",
    "different")
add("set-accounts-share", "settings-accounts", "Share",
    "Toasts a stub about sharing the account on this computer.",
    "window/src/places/settings/set1/accounts.tsx", "AccountsPage",
    "Share is missing or a real share flow — not the demo toast.",
    "different")
add("set-accounts-signout", "settings-accounts", "Sign out",
    "Toasts Signed out of <account>.",
    "window/src/places/settings/set1/accounts.tsx", "AccountsPage",
    "Signs out that account.",
    "different")
add("set-accounts-add", "settings-accounts", "Add an account",
    "Opens Sign in to Gemini (demo continue-on-their-site).",
    "window/src/places/settings/set1/accounts.tsx", "AccountsPage",
    "Starts Add an account / provider login.",
    "same")
add("set-accounts-low", "settings-accounts", "Warn me at 80% of the plan",
    "Demo switch.",
    "window/src/places/settings/set1/accounts.tsx", "AccountsPage",
    "Toggles the low-plan warning.",
    "same")
add("set-accounts-fallback", "settings-accounts", "Fall back to this computer",
    "Demo switch.",
    "window/src/places/settings/set1/accounts.tsx", "AccountsPage",
    "Toggles local fallback.",
    "same")
add("set-adv-restart", "settings-advanced", "Restart",
    "Toasts <service> restarted.",
    "window/src/places/settings/diagnostics.tsx", "diagnostics",
    "Restarts that service when the supervisor allows it; not a toast-only stub.",
    "different")
add("set-adv-logs", "settings-advanced", "Open logs",
    "Toasts Logs open in a new window.",
    "window/src/places/settings/pages/set4.tsx", "Advanced / Developer",
    "Opens logs when the desktop app can.",
    "different")
add("set-dev-copy", "settings-developer", "Copy",
    "Toasts Copied (local address).",
    "window/src/places/settings/pages/set4.tsx", "Developer page",
    "Copies the local address.",
    "same")
add("set-dev-new-key", "settings-developer", "Make a new one",
    "Toasts that a new session key was made.",
    "window/src/places/settings/pages/set4.tsx", "Developer page",
    "Rotates the session key when the engine allows it.",
    "different")
add("set-upd-install", "settings-updates", "Install when nothing is running",
    "Same as the update menu install toast.",
    "window/src/connect/desktop-component-updates.ts", "desktop component updates",
    "Applies the waiting update.",
    "different")
add("set-upd-auto", "settings-updates", "Keep Branch up to date by itself",
    "Demo switch.",
    "window/src/places/settings/pages/set3.tsx", "Updates page",
    "Toggles auto-apply via desktop controls.",
    "same")
add("set-upd-undo", "settings-updates", "Undo",
    "Toasts Goes back to the previous version from the safety copy.",
    "window/src/places/settings/pages/set3.tsx", "Updates page",
    "Undo last update when the updater supports it.",
    "different")

# ---------- palette / dialogs / first-run / lock ----------
add("palette-open", "palette", "Find anything",
    "Opens the command palette (Ctrl K).",
    "window/src/shell/Palette.tsx", "Palette",
    "Opens Find anything.",
    "same")
add("palette-item", "palette", "Palette row",
    "Runs that action / opens that conversation, place, or settings page.",
    "window/src/shell/palette-rows.ts", "paletteRows",
    "Runs the matching action. Action labels differ (Set up Branch vs Replay the first run; Browse themes vs Browse skins; Take the walkthrough vs Take the tour).",
    "different")
add("dlg-close", "dialogs", "Close",
    "Closes the open dialog (also Esc / scrim click).",
    "window/src/shell/Dialog.tsx", "Dialog",
    "Closes the dialog.",
    "same")
add("dlg-scrim", "dialogs", "Scrim",
    "Clicking the dimmed backdrop closes the dialog.",
    "window/src/shell/Dialog.tsx", "Dialog",
    "Scrim click closes.",
    "same")
add("shortcuts-dialog", "dialogs", "Keyboard shortcuts",
    "Lists the fixed shortcut table. Later: click a row, press keys to rebind.",
    "window/src/shell/ShortcutsDialog.tsx", "ShortcutsDialog",
    "Shows settable + fixed shortcuts; rows can be rebound.",
    "same")
add("pair-cancel", "dialogs", "Cancel",
    "Closes Pair a phone.",
    "window/src/places/customize/pairing.tsx", "pairing",
    "Closes pairing.",
    "same")
add("edit-trunk-shuffle", "dialogs", "Shuffle",
    "Randomizes colour, shape, and eyes.",
    "window/src/places/trunk/TrunkEditor.tsx", "TrunkEditor",
    "Randomizes colour, shape and eyes on a pebble look, or picks another unused character look.",
    "same")
add("edit-trunk-save", "dialogs", "Save",
    "Saves the Trunk look / permissions.",
    "window/src/places/trunk/TrunkEditor.tsx", "TrunkEditor",
    "Footer Save writes the Trunk look, name and permissions, then closes the editor.",
    "same")
add("edit-trunk-cancel", "dialogs", "Cancel",
    "Closes Edit Trunk without saving.",
    "window/src/shell/Dialog.tsx", "Dialog",
    "Cancels.",
    "same")
add("lock-pin", "lock-screen", "PIN digits",
    "Four PIN boxes; filling them unlocks (demo).",
    "window/src/places/settings/set1/permissions-top.tsx", "App lock",
    "App lock PIN is in Settings › Permissions; the lock screen unlocks with the set PIN.",
    "same")
add("first-next", "first-run", "Next",
    "Advances the first-run slideshow.",
    "window/src/setup/SetupFlow.tsx", "SetupFlow",
    "Setup is a real first-run, not the preview slideshow. Next advances the current setup step.",
    "different")
add("first-skip", "first-run", "Skip",
    "Exits the first-run slideshow.",
    "window/src/setup/SetupFlow.tsx", "SetupFlow",
    "Skip / later exits or defers setup.",
    "same")
add("tour-start", "dialogs", "Take the tour",
    "Starts the in-preview product tour.",
    "window/src/shell/palette-rows.ts", "paletteRows",
    "Take the walkthrough starts the app walkthrough.",
    "same")

# ---------- keyboard ----------
add("key-find-anything", "keyboard", "Ctrl K",
    "Opens Find anything.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Opens Find anything.",
    "same")
add("key-new-conversation", "keyboard", "Ctrl N",
    "Starts a new conversation.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Starts a new conversation.",
    "same")
add("key-settings", "keyboard", "Ctrl ,",
    "Opens Settings › Appearance.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Opens Settings (last page / General), not hard-wired to Appearance.",
    "different")
add("key-side-panel", "keyboard", "Ctrl Shift K",
    "Toggles the side panel on a chat.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Toggles the side panel.",
    "same")
add("key-focus", "keyboard", "Ctrl .",
    "Toggles focus mode.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Toggles focus mode.",
    "same")
add("key-newline", "keyboard", "Shift Enter",
    "Inserts a newline in the message box.",
    "window/src/composer/Composer.tsx", "Composer",
    "Inserts a newline.",
    "same")
add("key-shortcuts-list", "keyboard", "?",
    "Opens the shortcuts dialog when not typing.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Opens the shortcuts dialog.",
    "same")
add("key-escape", "keyboard", "Esc",
    "Closes popover, then dialog, then notes, then focus mode, then the sliding sidebar.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Closes the topmost overlay / leaves focus.",
    "same")
add("key-toggle-list", "keyboard", "Ctrl B",
    "Toggles the sidebar.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Toggles the list.",
    "same")
add("key-inbox", "keyboard", "Ctrl I",
    "Later preview: open Inbox.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Opens Inbox.",
    "same")
add("key-quick-ask", "keyboard", "Ctrl Shift Space",
    "Later preview: Quick ask.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Opens Quick ask.",
    "same")
add("key-find-in-chat", "keyboard", "Ctrl F",
    "Later preview: find in this conversation.",
    "window/src/thread/FindBar.tsx", "FindBar",
    "Opens find in this conversation.",
    "same")
add("key-list-search", "keyboard", "Ctrl G",
    "Later preview: focus list search.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Focuses list search.",
    "same")
add("key-lockdown", "keyboard", "Ctrl Shift L",
    "Later preview: toggle Lockdown.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Toggles Lockdown.",
    "same")
add("key-stop", "keyboard", "Ctrl Shift S",
    "Later preview: stop the current task.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Stops the current task.",
    "same")
add("key-talk-live", "keyboard", "Ctrl Shift V",
    "Later preview: talk live.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Starts talk live.",
    "same")
add("key-archive", "keyboard", "Ctrl Shift A",
    "Later preview: archive this conversation.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Archives the open conversation.",
    "same")
add("key-next-conversation", "keyboard", "Ctrl Tab",
    "Later preview: next conversation.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Goes to the next conversation.",
    "same")
add("key-talk-beside", "keyboard", "Ctrl Shift H",
    "Later preview: talk to the default Trunk beside a page.",
    "window/src/shell/use-shortcuts.ts", "useShortcuts",
    "Toggles talk-beside.",
    "same")
add("key-pane-terminal", "keyboard", "Ctrl `",
    "Later preview: Terminal pane.",
    "window/src/shell/use-shortcuts.ts", "paneKeyFor",
    "Opens Terminal.",
    "same")
add("key-pane-files", "keyboard", "Ctrl Shift B",
    "Later preview: Files pane.",
    "window/src/shell/use-shortcuts.ts", "paneKeyFor",
    "Opens Files.",
    "same")
add("key-stage-browser", "keyboard", "Ctrl Alt Shift U",
    "Later preview: Browser full size.",
    "window/src/shell/keymap.ts", "keyActions",
    "Ctrl Alt Shift U opens Browser full size (toggles it closed if already open).",
    "same")
add("key-stage-computer", "keyboard", "Ctrl Alt Shift D",
    "Later preview: Computer full size.",
    "window/src/shell/keymap.ts", "keyActions",
    "Ctrl Alt Shift D opens Computer full size (toggles it closed if already open).",
    "same")
add("key-talk-any-app", "keyboard", "Ctrl Alt Shift V",
    "Later preview: talk live from any app.",
    "window/src/shell/keymap.ts", "keyActions",
    "Greyed: keys that work from any app belong to the desktop app, which doesn't offer them yet.",
    "different")
add("key-settings-any-app", "keyboard", "Ctrl Alt ;",
    "Later preview: settings from any app.",
    "window/src/shell/keymap.ts", "keyActions",
    "Greyed: desktop-app-only.",
    "different")
add("toast-undo", "dialogs", "Undo",
    "On a toast that offers Undo, restores the previous state.",
    "window/src/shell/notify.ts", "notify",
    "Undo on toasts that register an undo callback.",
    "same")


def main() -> None:
    ids = [e["id"] for e in E]
    dup = [i for i, n in Counter(ids).items() if n > 1]
    if dup:
        raise SystemExit(f"duplicate ids: {dup}")
    allowed = {"same", "different", "missing", "extra", "dead", "unknown"}
    bad = [e["id"] for e in E if e["status"] not in allowed]
    if bad:
        raise SystemExit(f"bad status: {bad}")
    missing_files = sorted({e["appFile"] for e in E if e["appFile"] and not (ROOT / e["appFile"]).is_file()})
    if missing_files:
        raise SystemExit("appFile path does not exist: " + ", ".join(missing_files))
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(E, indent=2) + "\n", encoding="utf-8")
    counts = Counter(e["status"] for e in E)
    order = ["same", "different", "missing", "extra", "dead", "unknown"]
    lines = [
        "# Preview button map",
        "",
        "Unique clickable controls in `design/spec-v23` (the design preview) and where they go in `window/`.",
        "This is the expected-destination list for a click-every-button tester.",
        "",
        "Each JSON entry has `id`, `screen`, `label`, `previewAction`, `appFile`, `appComponent`, `appAction`, `status`.",
        "Statuses: `same` (app matches the preview), `different` (exists but destination or behaviour differs), `missing` (the preview has it, the app doesn't), `extra` (exists in the app, not in the preview), `dead` (app control does nothing / only a toast), `unknown` (could not determine statically).",
        "",
        "Demo labels only (Scout, Ledger, Sapling, Ada, Fieldnotes, Supplier quotes). Later-pass interpolated `data-act` keys that are not distinct product destinations are omitted; `scripts/parity/extract-preview-acts.mjs` lists raw act keys.",
        "",
        f"**{len(E)} controls.** Totals: "
        + ", ".join(f"{k} {counts[k]}" for k in order)
        + ".",
        "",
        "## Non-`same` entries",
        "",
    ]
    by_screen: dict[str, list] = {}
    for e in E:
        if e["status"] == "same":
            continue
        by_screen.setdefault(e["screen"], []).append(e)
    for screen, rows in by_screen.items():
        lines.append(f"### {screen}")
        lines.append("")
        lines.append("| id | label | status | preview | app |")
        lines.append("|---|---|---|---|---|")
        for e in rows:
            prev = e["previewAction"].replace("|", "\\|")
            app = e["appAction"].replace("|", "\\|")
            lines.append(f"| `{e['id']}` | {e['label']} | {e['status']} | {prev} | {app} |")
        lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {len(E)} entries → {OUT_JSON.relative_to(ROOT)}")
    print(" ".join(f"{k}={counts[k]}" for k in order))


if __name__ == "__main__":
    main()
