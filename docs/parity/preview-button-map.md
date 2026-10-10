# Preview button map

Unique clickable controls in `design/spec-v23` (the design preview) and where they go in `window/`.
This is the expected-destination list for a click-every-button tester.

Each JSON entry has `id`, `screen`, `label`, `previewAction`, `appFile`, `appComponent`, `appAction`, `status`.
Statuses: `same` (app matches the preview), `different` (exists but destination or behaviour differs), `missing` (the preview has it, the app doesn't), `extra` (exists in the app, not in the preview), `dead` (app control does nothing / only a toast), `unknown` (could not determine statically).

Demo labels only (Scout, Ledger, Sapling, Ada, Fieldnotes, Supplier quotes). Later-pass interpolated `data-act` keys that are not distinct product destinations are omitted; `scripts/parity/extract-preview-acts.mjs` lists raw act keys.

**379 controls.** Totals: same 263, different 98, missing 5, extra 9, dead 0, unknown 4.

## Non-`same` entries

### titlebar

| id | label | status | preview | app |
|---|---|---|---|---|
| `titlebar-guide` | Guide | different | Opens the Guide popover (design notes / critique pins) and toggles the notes layer. | Opens the Guide menu: What's new, Set up Branch, walkthrough, Docs, Get help, Community — not the prototype notes layer. |
| `titlebar-theme` | Switch light or dark | different | Toggles document theme between light and dark. | Toggles light/dark. Shown on place/settings headers; chat uses the conversation ⋯ or person menu Look instead. |
| `titlebar-focus` | Clear the view (Ctrl .) | missing | Toggles focus mode (hides sidebar and status bar). | Focus mode exists via Ctrl+. and Leave focus mode. No titlebar eye button. |
| `titlebar-minimize` | Minimize | different | Shows a toast: Branch keeps working from the tray. | Minimize is the OS/Electron window button, not a React control. In a browser there is no minimize control. |
| `titlebar-window-focus` | Focus mode | missing | Same as Clear the view: toggles focus mode. | No maximize/focus window button in the React chrome; focus is Ctrl+. |
| `titlebar-quit` | Quit | different | If a Trunk is working, opens a quit-while-working dialog; otherwise toasts that Branch closes to the tray. | Close is the OS/Electron window button. Settings › Gateway has a greyed 'Ask before quitting while work runs' row. |

### sidebar

| id | label | status | preview | app |
|---|---|---|---|---|
| `sidebar-machine` | This computer | different | Opens the machine switcher menu (talk to the assistant on another computer). | Opens the machine switcher. On wide layouts it sits in the top bar, not the sidebar top. |
| `sidebar-row-new-trunk` | New Trunk | different | Opens the just-made Trunk's setup conversation. | New Trunk is a + menu / Customize action that starts a setup conversation, not a standing demo row. |
| `sidebar-row-context-menu` | Conversation row context menu | different | Right-click / ⋯ on a row opens pin, rename, pause, archive, copy, delete. | Opens the row menu with pin, snooze, archive, copy, rename, and more. Pause is listed but greyed (no engine method). |
| `sidebar-projects` | Projects | different | Toggles the projects fold and opens a project view. | Folds projects and lists their conversations. Opening a project is a conversation filter, not a separate project screen. |
| `sidebar-update-chip` | Update chip | missing | On the person row, a copper Update chip opens the update menu. | Update to Branch <version> is a person-menu row, not a chip on the sidebar row. |

### chat-header

| id | label | status | preview | app |
|---|---|---|---|---|
| `chat-header-name` | Conversation name | different | Shows the name; rename replaces it with an input (Enter saves, Esc cancels). | Click opens the Trunk profile. Rename uses the same in-header field. |
| `chat-computer-view` | Computer view | different | Toggles the side panel on the Computer tab. | Opens Computer full-size / the Computer pane, not only a pressed icon in the header. |
| `chat-side-panel` | Side panel | different | Toggles the side panel on Activity (or closes it if already a non-computer pane). | Toggles the side panel (Ctrl Shift K). Header uses conversation ⋯ › Side panel more than a dedicated icon. |
| `chat-back` | Back | extra | Not in the early preview header. | History back. Preview has no back/forward in the chat header. |
| `chat-forward` | Forward | extra | Not in the early preview header. | History forward. |
| `teach-stop` | I'm done, save it | different | Stops teach mode and saves a procedure under Automations › Procedures. | Show it how, once is listed and greyed: needs an engine method. |
| `call-mute` | Mute | different | Toasts that the Trunk can't hear you. | Live call has real mute/camera controls, not a toast-only Mute on a header bar. |
| `call-pause` | Pause | missing | Toasts Paused. | No header call Pause button. Live voice is a composer overlay. |

### composer

| id | label | status | preview | app |
|---|---|---|---|---|
| `composer-talk-live` | Talk live with voice | different | Preview talk-out-loud is on the conversation ⋯ menu (Talk out loud). | Starts a live voice session from a composer icon (Ctrl Shift V). |
| `empty-sugg-tidy` | Tidy my Downloads folder | different | Fills the draft with the chip text and sends. | Suggested replies insert/send. Empty-chat chips in the preview are four fixed demos; the app uses live suggestions. |
| `empty-sugg-flight` | Find a cheap refundable flight to Lisbon in March | different | Fills the draft and sends. | Live suggestions, not this fixed chip. |
| `empty-sugg-pdfs` | Summarise the PDFs on my desktop | different | Fills the draft and sends. | Live suggestions, not this fixed chip. |
| `empty-sugg-week` | Plan my week from my calendar | different | Fills the draft and sends. | Live suggestions, not this fixed chip. |
| `empty-ask-trunk` | Ask <Trunk> | different | Opens that Trunk's conversation from the empty-chat row. | New conversation › with <Trunk> starts a conversation. Empty chat does not list Trunk faces. |

### plus-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `plus-temporary` | Temporary conversation | different | Toggles temporary on the current conversation (unsaved, not remembered). | Starts a new temporary conversation when the engine supports incognito create; otherwise greyed. Does not flip the open conversation. |
| `plus-check-with-me` | Check with me | different | Toggles ask-questions-first on this conversation. | Greyed: the engine has no ask-questions-first switch. |
| `plus-think-quick` | Quick | different | Sets thinking to Quick and keeps the + menu open. | Thinking depth lives on the model chip, not as Quick/Normal/Deep in +. |
| `plus-think-normal` | Normal | different | Sets thinking to Normal. | Thinking is on the model chip. |
| `plus-think-deep` | Deep | different | Sets thinking to Deep. | Thinking is on the model chip. |
| `plus-who-answers` | Whoever fits | different | In a room, picks who answers (Whoever fits / Scout / Ledger). | Who answers here lists Trunks; the conversation's Trunk is often fixed after the first message. |
| `plus-google-drive` | From Google Drive | extra | Not in the early + menu. | Listed and greyed: Google's picker opens in the desktop app. |
| `plus-onedrive` | From OneDrive or SharePoint | extra | Not in the early + menu. | Listed and greyed. |
| `plus-saved-prompts` | Saved prompts | different | Later preview has a prompts picker. | Greyed: engine keeps no saved prompts. |
| `plus-office-doc` | Write a document, spreadsheet or slides | different | Later preview office-make row. | Greyed: no document command. |
| `plus-gif` | Find a GIF… | different | Later preview GIF search. | Greyed: no GIF search. |
| `plus-improve` | Improve my draft | different | Later preview rewrite-draft. | Greyed: can't rewrite without sending. |
| `plus-phone-call` | Phone call… | different | Later preview phone-call row. | Greyed; click goes to Settings › Voice. |
| `plus-meeting` | Join a meeting… | different | Later preview meeting row. | Greyed; click goes to Settings › Voice. |

### new-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `new-conversation` | New conversation | different | Creates a new conversation with Sapling (Ctrl N). | Submenu: New conversation with each Trunk (default marked). Ctrl N still starts one. |

### person-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `person-switch` | Switch person | missing | Cycles the demo person (Owner ↔ Guest) and toasts. | No Switch person row. Add opens inviting another person. |
| `person-add` | Add | extra | Not in the early owner menu (Invite lives in Settings › People). | Add person. |
| `person-help` | Help and design notes | different | Toggles the prototype Guide/notes layer. | Guide opens the product Guide menu, not design-critique pins. |
| `person-replay` | Replay the first run | different | Replays the first-run / setup flow. | Label is Set up Branch; opens setup, not a design-preview first-run slideshow. |

### conversation-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `cmenu-pause` | Pause this Trunk | different | Pauses the Trunk so it won't start anything new. | Listed and greyed: pausing needs an engine method. |
| `cmenu-teach` | Show it how, once | different | Starts teach mode on that Trunk. | Listed and greyed. |
| `cmenu-export` | Export conversation | different | Toasts that it saved Markdown to Library › Documents. | Opens Export (Markdown, HTML, HTML replay). Not a toast-only save. |
| `cmenu-room-add` | Add a Trunk to this room | different | Toasts pick-a-Trunk (stub). | Room menu has real add/rename/leave rows where the engine supports them. |
| `cmenu-room-rules` | Room rules | different | Toasts a stub about who answers first. | Room rules exist as real rows when the engine has them; not a toast. |
| `cmenu-room-leave` | Leave and archive | different | Toasts Archived. Find it in search. | Archive / leave is a real engine action, not a toast. |

### machines-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `machines-add` | Add a computer… | different | Toasts: open Branch on the other computer and scan the code. | Opens the Add a computer dialog (pairing), not a toast. |

### model-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `model-second-opinion` | Second opinion on hard questions | different | Toggles a demo second-opinion switch (plain toast). | Second opinion is a Settings › Models control, not a status-bar menu switch. |

### room-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `room-tidy` | Tidy up this conversation | unknown | Toasts Older parts summarised. 94% free. | Context / room-left popover. Tidy is not a toast-only stub when compaction exists; otherwise unknown. |

### update-menu

| id | label | status | preview | app |
|---|---|---|---|---|
| `update-install` | Install when nothing is running | different | Toasts that 0.20.0 will install, with Undo that cancels. | Applies the waiting update through the desktop updater, not a demo toast. |

### status-bar

| id | label | status | preview | app |
|---|---|---|---|---|
| `status-connection` | Connected · this computer | different | Opens the machines menu. | Opens the connection popover (machine + gateway), not only the machines menu. |
| `status-mode` | Ask first | different | Opens the how-much-may-Trunks-do menu. | Mode/Lockdown is a status extra, not always a dedicated Ask first chip. |
| `status-model` | Qwen3.6 35B · this computer | different | Opens the model menu. | Model lives on the composer chip, not a status-bar model button. |
| `status-spend` | Today $0.00 | different | Opens the spend popover. | Usage ring opens every-account usage (hover expands). Not a Today $0.00 text chip. |
| `status-pet` | Acorn companion | different | Cycles a tip toast while any Trunk works. | The acorn lives at the foot of the list (and can sit in status extras). Click still reacts / tips. |

### side-pane

| id | label | status | preview | app |
|---|---|---|---|---|
| `pane-tab-computer` | Computer | different | Shows the Computer pane tab. | Computer is a full-size stage and/or a pane tab, depending on layout. |
| `pane-tab-plan` | Plan | different | Shows the plan. | Plan is in the thread and/or pane; tab set differs (Activity, Files, Memory, Terminal, Side chat, …). |
| `pane-memory-forget` | Forget | different | Toasts Forgotten. It won’t use this again. | Forget is a Library / memory action, not only a pane toast. |

### thread

| id | label | status | preview | app |
|---|---|---|---|---|
| `msg-branch` | Branch from here | different | Toasts: Starts a new conversation from this point. | Branches when the engine supports it; otherwise greyed. Not toast-only. |
| `msg-flag` | Report a problem | different | Opens the flag dialog. | Greyed: you can't flag replies here yet. |
| `thread-watch-pane` | Watch in the side panel | different | Opens the Computer pane. | Opens computer full size / the stage; wording differs. |
| `thread-file-open` | File card | different | Navigates to Library › Made for you. | Opens the file or Files pane, not always Library. |
| `thread-art-save` | Save to Library | unknown | Saves the chart to Library. | Save-to-Library on made artifacts when the engine supports it. |
| `thread-ckpt-undo` | Put it all back | unknown | Restores the checkpoint (with toast Undo). | Checkpoint restore when the engine exposes it. |

### overview

| id | label | status | preview | app |
|---|---|---|---|---|
| `overview-pause-all` | Pause all Trunks | different | Pauses or resumes every Trunk. | Listed and greyed: needs the engine's pause-all method. |

### inbox

| id | label | status | preview | app |
|---|---|---|---|---|
| `inbox-tab-later` | Later | extra | Not in the early preview inbox tabs. | Shows Later (snoozed). |
| `inbox-watch-again` | Watch again | different | Toasts: Plays the task back step by step. | Replay/open the run when the engine has it; not a toast-only stub. |

### automations

| id | label | status | preview | app |
|---|---|---|---|---|
| `auto-run-now` | Run now | different | Toasts Running <name>… | Runs the job now through the engine, not a toast-only stub. |
| `auto-teach` | Show a Trunk how, once | different | Starts teach mode. | Teach-from-watching is missing or greyed (no engine method). |

### library

| id | label | status | preview | app |
|---|---|---|---|---|
| `lib-tab-meetings` | Meetings | extra | Not in the early preview library tabs. | Shows Meetings. |
| `lib-tab-logbook` | Logbook | extra | Not in the early preview library tabs. | Shows Logbook. |
| `lib-write` | Write a new document | different | Toasts: Opens a blank document a Trunk can help write. | Head actions Canvas / Translate / Make pictures are greyed (engine gaps). No toast-only Write button. |
| `lib-open` | Open | different | Toasts: Opens in its own app. | Opens the document when the engine can; not a toast-only stub. |
| `lib-canvas` | Canvas | different | Later preview Clearings/canvas. | Greyed: needs an engine method that lists Clearings. |

### customize

| id | label | status | preview | app |
|---|---|---|---|---|
| `cz-tab-skills` | Skills | different | Shows skill toggles. | Skills live under Tools, not a top-level Customize tab. |
| `cz-tab-plugins` | Plugins | different | Shows plugin toggles. | Plugins live under Tools. |
| `cz-tab-connections` | Connections | different | Shows app connections. | Connectors live under Tools. |
| `cz-tab-channels` | Channels | different | Shows chat apps + pair a phone. | Tab label is Chat apps. |
| `cz-pause-trunk` | Pause | different | Pauses or resumes that Trunk. | Pause is missing or greyed (no engine method). |
| `cz-channel-setup` | Set up | different | Toasts a two-minute setup stub, or Manage if already connected. | Starts the real chat-app setup / manage flow. |
| `cz-connect` | Connect | different | Toasts sign-in-on-their-site, or Manage if connected. | Starts the connector sign-in / manage flow. |

### settings

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-nav-seasons` | Seasons | extra | Not in the preview SET_NAV. | Opens Settings › Seasons. Preview has no Seasons page. |
| `set-show-everything` | Show everything | different | Toggles extra pages (Advanced, Developer). Off drops those pages back to General. | Level control is a three-way Regular / Advanced / Technical segmented control, not a single checkbox. |

### settings-general

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-keep-working` | Keep working when the window closes | different | Demo switch (toast). | Keep-working / tray is on Gateway and desktop controls, not this General row. |
| `set-project-edit` | Edit | different | Toasts: Edit this project's instructions. | Edit is disabled: can't open a project's instructions from here yet. |

### settings-people

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-people-edit` | Edit | different | Toasts: Change what <person> may do. | Edits the person when the engine allows; some rows greyed. |
| `set-people-pin` | Ask for a PIN when switching person | different | Demo switch. | App lock / PIN lives under Permissions and People; wiring differs. |
| `set-people-separate` | Keep conversations separate | different | Demo switch. | Row exists; may be greyed (engine gap). |

### settings-appearance

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-language` | Language | different | Toasts that the prototype stays in English. | Language select exists; switching languages is real or limited — not a prototype-stays-English toast. |

### settings-models

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-models-tab` | Connections / Defaults / On this computer / Second opinion / Media | different | Switches Models sub-tabs. | Models is one page with sections; On this computer is also its own nav page. |
| `set-models-signin` | Sign in | different | Toasts sign-in-on-their-site. | Starts the real provider sign-in. |
| `set-models-use` | Use this | different | Toasts that the local model is now the default. | Selects that local model. |
| `set-models-download` | Get another model | different | Opens the download-model dialog (demo progress). | Starts a local-model download through desktop/engine, not a fake progress bar. |

### settings-voice

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-voice-ptt` | Change | different | Toasts: Press the key you want to use. | Push-to-talk / Talk live keys are set in Keyboard shortcuts, not a toast. |

### settings-permissions

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-perm-record` | Record tasks so you can watch them again | unknown | Demo switch. | Toggles recording if the engine has it; otherwise greyed. |
| `set-perm-trusted` | Add | different | Toasts: Add a folder Trunks may change without asking. | Trusted folders are real or greyed — not a toast-only Add. |

### settings-computer

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-comp-manage` | Manage | different | Toasts Manage <computer>. | Manages that node/computer when the engine lists it. |

### settings-secrets

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-secrets-remove` | Remove | different | Toasts that the sign-in was removed. | Removes that fillable sign-in when the engine supports it. |

### settings-usage

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-usage-backup` | Back up | different | Toasts Backed up to a demo path. | Back up is on Settings › Backups and runs a real backup, not a toast to a demo path. |
| `set-usage-ckpt` | See all | different | Toasts 3 checkpoints kept this week. | Lists checkpoints when the engine has them. |

### settings-accounts

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-accounts-share` | Share | different | Toasts a stub about sharing the account on this computer. | Share is missing or a real share flow — not the demo toast. |
| `set-accounts-signout` | Sign out | different | Toasts Signed out of <account>. | Signs out that account. |

### settings-advanced

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-adv-restart` | Restart | different | Toasts <service> restarted. | Restarts that service when the supervisor allows it; not a toast-only stub. |
| `set-adv-logs` | Open logs | different | Toasts Logs open in a new window. | Opens logs when the desktop app can. |

### settings-developer

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-dev-new-key` | Make a new one | different | Toasts that a new session key was made. | Rotates the session key when the engine allows it. |

### settings-updates

| id | label | status | preview | app |
|---|---|---|---|---|
| `set-upd-install` | Install when nothing is running | different | Same as the update menu install toast. | Applies the waiting update. |
| `set-upd-undo` | Undo | different | Toasts Goes back to the previous version from the safety copy. | Undo last update when the updater supports it. |

### palette

| id | label | status | preview | app |
|---|---|---|---|---|
| `palette-item` | Palette row | different | Runs that action / opens that conversation, place, or settings page. | Runs the matching action. Action labels differ (Set up Branch vs Replay the first run; Browse themes vs Browse skins; Take the walkthrough vs Take the tour). |

### first-run

| id | label | status | preview | app |
|---|---|---|---|---|
| `first-next` | Next | different | Advances the first-run slideshow. | Setup is a real first-run, not the preview slideshow. Next advances the current setup step. |

### keyboard

| id | label | status | preview | app |
|---|---|---|---|---|
| `key-settings` | Ctrl , | different | Opens Settings › Appearance. | Opens Settings (last page / General), not hard-wired to Appearance. |
| `key-talk-any-app` | Ctrl Alt Shift V | different | Later preview: talk live from any app. | Greyed: keys that work from any app belong to the desktop app, which doesn't offer them yet. |
| `key-settings-any-app` | Ctrl Alt ; | different | Later preview: settings from any app. | Greyed: desktop-app-only. |
