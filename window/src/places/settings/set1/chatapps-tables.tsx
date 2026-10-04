// Settings › Chat apps at Advanced and Technical (§4.7.10): the preview's sections as tables. Each row names the
// engine config key it saves (messages.*, commands.*, channels.defaults.*, agents.defaults.* reply streaming,
// approvals.exec.*), its choices as the engine's values and the source default; rows with no engine key are greyed.
import type { Opt, Row, Section } from "./chatapps-kit";
import { NO_KEY } from "./chatapps-kit";

export const CMD_WHO = ["Everyone allowed", "Owners only", "In direct messages only", "Nobody"];
export const CMD_OFF = "Branch can’t limit one command yet; use “Who may use commands”.";
const sw = (t: string, path: string, def: boolean, sub?: string, lv?: 0 | 1 | 2): Row => ({ t, sub, path, kind: "sw", def, lv });
const offSw = (t: string, def: boolean, sub?: string, off = NO_KEY): Row => ({ t, sub, kind: "sw", def, off });
const offSeg = (t: string, labels: string[], sub?: string, off = NO_KEY): Row => ({ t, sub, kind: "seg", opts: labels.map((l, i) => [l, i]), def: 0, off });
const QUEUE: Opt[] = [["Add to the task", "steer"], ["Answer after", "followup"], ["Gather, then answer", "collect"], ["Stop and answer the newest", "interrupt"]];
export const QUEUE_MODES = QUEUE;
const CONFIG_CMD = "Commands that change how Branch is set up. Owners only. Off until you choose: owners could change Branch from a chat.";

export const ADVANCED: Section[] = [
  { title: "Commands in chat apps", lv: 1, hint: "Who may use which commands, in each chat app.", rows: [
    { t: "Who may use each command", kind: "custom", id: "cmdRows" },
    { t: "Slack app file", sub: "Every Branch command becomes a Slack command.", kind: "custom", id: "slackFile" },
  ] },
  { title: "What the Trunk sees", lv: 1, rows: [
    offSw("Edited messages", true, "When you edit a message, the Trunk sees the latest version and answers that one."),
    offSw("Photo albums as one message", true, "Ten photos sent together arrive as one message, not ten."),
    { t: "Wait for messages split in two", sub: "Some apps split long messages; Branch joins them first. Telegram waits 0.3 seconds unless you choose.", path: "messages.inbound.debounceMs", kind: "seg", opts: [["Off", 0], ["0.3 seconds", 300], ["1 second", 1000], ["3 seconds", 3000]], def: 0 },
  ] },
  { title: "Staying connected", lv: 1, rows: [
    { t: "Watch for a chat app that stops receiving", sub: "If no update arrives for a while, Branch reconnects it and tells you if that fails.", kind: "custom", id: "watch" },
    { t: "Reconnect after", sub: "Checked every 5 minutes. Quiet apps are checked, not restarted; one with no sign of life for 30 minutes is reconnected, at most 10 times an hour.", kind: "num", unit: "minutes", def: 30, off: "The engine checks on its own schedule; Branch can’t change it yet." },
    offSw("Show online or offline in the app", false, "The bot’s description says “Online” or “Offline, back soon”, so people know."),
    { t: "Watchdog", kind: "custom", id: "watchdog" },
  ] },
  { title: "Formatting in each app", lv: 1, hint: "Replies are written once and turned into each app’s own formatting.", rows: [{ t: "Formatting", kind: "custom", id: "formatting" }] },
  { title: "How replies arrive", lv: 1, rows: [
    { t: "Long replies", sub: "Long replies arrive in one message at the end. Off until you choose: “In parts” sends each finished paragraph as it is written. A Trunk’s own settings can override it.", path: "agents.defaults.blockStreamingDefault", kind: "seg", opts: [["In parts", "on"], ["All at once", "off"]], def: "off" },
    { t: "Show typing", sub: "The app’s “typing…” shows while a Trunk works on your message. In groups where it wasn’t mentioned, it shows when it writes. A Trunk’s own settings can override it.", path: "agents.defaults.typingMode", kind: "seg", opts: [["Right away", "instant"], ["While thinking", "thinking"], ["When it writes", "message"], ["Never", "never"]], def: "instant" },
    { t: "Pause between parts", sub: "A short random pause before each part, so it reads like someone typing. A Trunk’s own settings can override it.", path: "agents.defaults.humanDelay.mode", kind: "seg", opts: [["None", "off"], ["Like a person", "natural"], ["Custom", "custom"]], def: "off" },
    { t: "Shortest", kind: "custom", id: "delayMin" },
    { t: "Longest", kind: "custom", id: "delayMax" },
    offSw("Link back to the conversation", false, "When a reply finishes, its progress card in Slack (and discussion threads in other apps) ends with “Open in Branch”, or “Open <task>” for each piece of work, up to five."),
  ] },
  { title: "How replies are sent", lv: 1, rows: [
    { t: "Messages sent while it works", sub: "What happens to a new message from a chat app while the Trunk is still working. (Inside Branch the waiting line does this.)", path: "messages.queue.mode", kind: "seg", opts: QUEUE, def: "steer" },
    { t: "Per app", kind: "custom", id: "queueByApp" },
    { t: "Acknowledge with a reaction", sub: "A quick reaction to show your message arrived. Discord, Matrix, Slack and Telegram can set their own on their page; WhatsApp reacts only when a reaction is set here.", path: "messages.ackReactionScope", kind: "seg", opts: [["Group mentions", "group-mentions"], ["Every group message", "group-all"], ["Direct messages", "direct"], ["Everything", "all"], ["Off", "off"]], def: "group-mentions" },
    { t: "Reaction", path: "messages.ackReaction", kind: "pick", opts: [["The Trunk’s own emoji, or eyes", undefined], ["👀", "👀"], ["👍", "👍"], ["✅", "✅"], ["🌿", "🌿"], ["⏳", "⏳"]] },
    { t: "Mark replies with", sub: "Text put before every reply in chat apps, such as [Name]. “auto” puts the Trunk’s name in brackets; {model}, {provider} and {thinkingLevel} fill in live. Each app’s page can set its own; empty there means “as here”.", path: "messages.responsePrefix", kind: "text", ph: "Nothing" },
    { t: "Usage under each reply", sub: "A small line under each reply with what it used. /usage in a chat changes it for that chat.", path: "messages.responseUsage", kind: "seg", opts: [["Off", "off"], ["Tokens", "tokens"], ["Full", "full"]], def: "off" },
    { t: "Show progress as reactions", kind: "custom", id: "progress" },
    { t: "Replies in groups", sub: "Whether each answer posts by itself, or only when the Trunk chooses to send it.", path: "messages.groupChat.visibleReplies", kind: "seg", opts: [["Every reply", "automatic"], ["Only what it sends on purpose", "message_tool"]], def: "automatic" },
    { t: "Hold up to", sub: "Messages that arrive while the Trunk works are held up to this many.", path: "messages.queue.cap", kind: "num", unit: "messages", def: 20 },
    { t: "Then", path: "messages.queue.drop", kind: "seg", opts: [["Summarise the oldest", "summarize"], ["Drop the oldest", "old"], ["Refuse new ones", "new"]], def: "summarize" },
    sw("Say when all is fine", "channels.defaults.heartbeatVisibility.showOk", false, "A check-in with nothing to report stays quiet. Off until you choose: it would post every quiet check-in."),
    sw("Send check-in alerts", "channels.defaults.heartbeatVisibility.showAlerts", true, "What a check-in posts in chat apps when something needs you."),
    sw("Show a check-in mark", "channels.defaults.heartbeatVisibility.useIndicator", true, "A small mark shows a check-in ran."),
  ] },
  { title: "Groups", lv: 1, rows: [
    offSw("In groups, answer only when mentioned", true, "Groups stay quiet until someone mentions the Trunk (WhatsApp, Telegram, Discord, Google Chat, iMessage). A group’s own choice, or /activation in it, wins.", "Each app and group sets this on its own page."),
    { t: "Names that wake it", sub: "One per line, such as “sapling”. Case doesn’t matter. Patterns that could match everything are ignored. Empty: @mentions only.", path: "messages.groupChat.mentionPatterns", kind: "lines" },
    { t: "Earlier messages it reads in a group", sub: "How much of the chat it looks back at for each answer. 0 reads none. Nothing is deleted.", path: "messages.groupChat.historyLimit", kind: "num", unit: "messages", def: 50 },
    { t: "Earlier messages it reads in a direct chat", sub: "Each app’s page and each direct chat can set its own.", kind: "num", unit: "messages", ph: "No limit", off: "Each app sets this on its own page." },
    { t: "Groups, for every app", sub: "Which groups a Trunk answers in when an app has no choice of its own. An app’s own choice wins.", path: "channels.defaults.groupPolicy", kind: "seg", opts: [["Groups I approve", "allowlist"], ["Any group", "open"], ["No groups", "disabled"]], def: "allowlist" },
    { t: "Quotes and thread history it sees", sub: "Earlier messages, quotes and threads fetched with your message. An app’s page can set its own.", path: "channels.defaults.contextVisibility", kind: "seg", opts: [["Everyone’s", "all"], ["Only from people allowed", "allowlist"], ["People allowed, plus quotes", "allowlist_quote"]], def: "all" },
    sw("A reply to the Trunk", "channels.defaults.implicitMentions.replyToBot", true, "These wake it in a group as a mention would. Slack, Mattermost and Tlon read these; elsewhere they always count."),
    sw("Quoting the Trunk", "channels.defaults.implicitMentions.quotedBot", true),
    sw("A thread it’s in", "channels.defaults.implicitMentions.threadParticipation", true),
  ] },
  { title: "Commands from chat apps", lv: 1, rows: [
    { t: "Commands in the app’s menu", sub: "Branch’s commands appear in the app’s own / menu. Auto: on in Discord and Telegram, off in Slack. Each app’s page can override it.", path: "commands.native", kind: "seg", opts: [["Auto", "auto"], ["On", true], ["Off", false]], def: "auto" },
    { t: "Skills in the app’s menu", path: "commands.nativeSkills", kind: "seg", opts: [["Auto", "auto"], ["On", true], ["Off", false]], def: "auto" },
    sw("Typed commands", "commands.text", true, "A message that starts with / runs the command."),
    sw("Run ! commands from chat apps", "commands.bash", false, "“! <command>” runs it on this computer, only for people who may run commands with raised rights (Permissions). Off until you choose: people in your chat apps could run commands here."),
    { t: "Wait before it moves to the background", path: "commands.bashForegroundMs", kind: "num", unit: "seconds", scale: 1000, def: 2000, lv: 2 },
    sw("Change settings (/config)", "commands.config", false, CONFIG_CMD), sw("Connectors (/mcp)", "commands.mcp", false, CONFIG_CMD),
    sw("Plugins (/plugins)", "commands.plugins", false, CONFIG_CMD), sw("Debug (/debug)", "commands.debug", false, CONFIG_CMD),
    sw("Restart (/restart)", "commands.restart", true, "An owner can restart the engine from a chat. Owners only."),
    { t: "Owners in chat apps", sub: "Owners answer approvals and run owner commands from chat apps, and can export a conversation.", kind: "custom", id: "owners" },
    { t: "Who may use commands", sub: "Commands follow each app’s “Who may message it” unless you name people here.", kind: "custom", id: "cmdWho" },
  ] },
  { title: "Live screen in chat apps", lv: 1, rows: [offSw("/screen in your chat with Branch", false, "Send /screen in your own paired chat to watch an app window live; /screen stop ends it. Only you, only in that chat. Off until you choose: your screen shows in a chat app.")] },
  { title: "Approvals in chat apps", lv: 1, rows: [
    sw("Send approvals to chat apps", "approvals.exec.enabled", false, "Approval requests also go to a chat, where an owner can answer them with the buttons there; the answer reaches the Inbox at once. Off until you choose: requests would be posted into those chats."),
    { t: "Where", kind: "custom", id: "apprWhere" },
  ] },
  { title: "Lists of people", lv: 1, rows: [{ t: "Lists", kind: "custom", id: "lists" }] },
  { title: "What Trunks may do in chat apps", lv: 1, hint: "Things a Trunk can do in a chat besides replying, where the app supports it. Off stops that one in every app.", rows: [{ t: "Actions", kind: "custom", id: "actions" }] },
];

export const TECH_A: Section[] = [
  { title: "Chat apps, technical", lv: 2, rows: [
    { t: "Call it stalled after", sub: "No update from the app for this long. Telegram: 120 seconds; other apps: 30 minutes.", kind: "num", unit: "seconds", def: 120, off: "The engine decides this on its own; Branch can’t change it yet." },
    { t: "Watchdog log", sub: "One line each time it checks or reconnects.", kind: "custom", id: "watchLog" },
    { t: "Smallest part", sub: "How replies are cut into parts.", path: "agents.defaults.blockStreamingChunk.minChars", kind: "num", unit: "characters", def: 800 },
    { t: "Largest part", path: "agents.defaults.blockStreamingChunk.maxChars", kind: "num", unit: "characters", def: 1200 },
    { t: "Break at", path: "agents.defaults.blockStreamingChunk.breakPreference", kind: "seg", opts: [["Paragraph", "paragraph"], ["Line", "newline"], ["Sentence", "sentence"]], def: "paragraph" },
    { t: "Wait for more before sending", sub: "Discord, Google Chat, Mattermost, Teams, Signal and Slack join parts up to 1500 characters.", path: "agents.defaults.blockStreamingCoalesce.idleMs", kind: "num", unit: "ms", def: 1000 },
    { t: "A part ends at", path: "agents.defaults.blockStreamingBreak", kind: "seg", opts: [["End of text", "text_end"], ["End of message", "message_end"]], def: "text_end" },
    { t: "Refresh typing every", path: "agents.defaults.typingIntervalSeconds", kind: "num", unit: "s", def: 6 },
    { t: "React", sub: "Every action a Trunk can take in a chat app, from a script.", kind: "custom", id: "code:branch message react --channel discord --target channel:<id> --message-id <id> --emoji thumbsup" },
    { t: "Read", kind: "custom", id: "code:branch message read --channel slack --target channel:<id>" },
    { t: "Send to several chats", kind: "custom", id: "code:branch message broadcast --targets <a> <b> --message \"Done\"" },
    { t: "Your own ID", sub: "IDs to paste into lists here or into branch message.", kind: "custom", id: "code:branch directory self --channel telegram" },
    { t: "Contacts", kind: "custom", id: "code:branch directory peers list --channel slack --query <name>" },
    { t: "Groups and members", kind: "custom", id: "code:branch directory groups list --channel whatsapp" },
  ] },
  { title: "Messages, every setting", lv: 2, hint: "Every message setting the engine has, by its key. The rows above set the common ones.", rows: [{ t: "Message keys", kind: "custom", id: "msgKeys" }] },
];

export const DEPTH: Section = { title: "Each app, in depth", lv: 1, hint: "What only one app can do. Each applies once that app is connected.", rows: [{ t: "Apps", kind: "custom", id: "depth" }] };

const EVERY_CHAT = "Branch has no setting for this yet.";
export const LATER: Section[] = [
  { title: "In every chat", lv: 1, rows: [
    offSw("Shared locations", true, "A pin or live location someone sends becomes words the Trunk can use.", EVERY_CHAT),
    offSw("Reactions and joins reach the Trunk", true, "A reaction to its message, someone joining, an edit.", "Each app sets this on its own page."),
    offSw("Questions as buttons", true, "Where an app has buttons; elsewhere a numbered list."),
    offSw("Answer a question with a number", true, "In WhatsApp, Signal and iMessage, react 1️⃣–4️⃣ to pick."),
    offSw("Approve with a reaction", true, "In WhatsApp, Signal and Matrix, 👍 or 👎 from the person asked."),
    offSeg("Very long replies", ["As messages", "As a picture", "As one folded message"], "Past a few screens."),
    offSw("Write the reply live", true, "One message fills in as it is written; only the finished one notifies.", "Each app sets this on its own page."),
    offSw("Show steps in chats", true, "One quiet message lists what the Trunk does, edited as it goes; a new one starts when it gets long. The answer is its own message.", "Each app sets this on its own page."),
    offSeg("Steps shown", ["Off", "New kinds", "All", "Every detail"], "/verbose in a chat changes it there. Texts (SMS) never get steps."),
    offSw("Remove the steps once it answers", false, "Off until you choose: the steps message is deleted after the answer."),
    offSw("Keep steps private in groups", true, "In a group, steps say how many and what kind, never names, files or commands."),
    offSw("Say when a task goes quiet", true, "A short note if nothing has happened for a while; it goes away when work picks up."),
    offSw("Pinned task list", false, "One pinned message shows what the Trunk is doing and what’s next. Off until you choose: it pins a message."),
    offSw("Show thinking in chats", false, "Off until you choose: it posts the model’s reasoning."),
    offSeg("Branch’s own warnings", ["In the chat", "Only to me", "Nowhere"], "Notices that aren’t answers, such as “room is running low”."),
    offSeg("When a reply fails", ["A short hint", "The error", "Nothing"]),
    { t: "Delete short notices after", sub: "Where the app allows deleting. Empty keeps them.", kind: "num", unit: "s", ph: "Keep", off: NO_KEY },
    offSw("Post when background work finishes", true, "The chat that started it hears when it’s done."),
    offSw("Say when Branch is back after a restart", true, "The chat that asked for the restart hears how long it took."),
    offSw("Hold back in busy groups", true, "It answers less when it has been doing most of the talking."),
    offSeg("Join in unasked", ["Never", "Sometimes"], "In groups you pick, now and then, without being mentioned."),
    { t: "Introduction when added to a group", sub: "Posted once. Empty: a short hello that says what it can do.", kind: "lines", off: "Each app sets this on its own page." },
    offSeg("Replies to people other than you", ["Send them", "Draft them for my yes"]),
    offSeg("If I don’t answer something urgent", ["Stop there", "Each chat app in turn, then my phone"], "Tries each place in order until you see it."),
    offSw("Use the phone from a chat", false, "A chat can ask for the lent phone’s camera, location and notifications. Off until you choose: Lend this phone still decides what it may use."),
    offSw("Waiting terminal sessions send a card", false, "A session that waits for you sends Allow and Deny to your chat; reply “2: text” to type into session 2. Off until you choose: it posts into your chat."),
    offSw("Keep answering while this computer is off", false, "A small stand-in on Cloudflare answers and queues work, then hands back. Off until you choose: it uses your Cloudflare account."),
    { t: "Stays connected through updates", sub: "Chat apps keep running while Branch updates.", kind: "custom", id: "updates" },
  ] },
  { title: "Quiet and limits", lv: 1, rows: [
    { t: "Chats answered at once", sub: "Empty means no limit. Past it, a new chat gets a polite “busy, try soon”.", kind: "num", unit: "chats", ph: "No limit", off: NO_KEY },
    { t: "Messages per chat, per minute", sub: "Empty means no limit.", kind: "num", unit: "a minute", ph: "No limit", off: NO_KEY },
    offSeg("Past the limit", ["Wait for the next minute", "Drop the extra"]),
    { t: "Replies to another bot, at most", sub: "Per conversation, so two bots never answer each other forever.", path: "channels.defaults.botLoopProtection.maxEventsPerWindow", kind: "num", unit: "replies", ph: "20" },
    { t: "Answer only between", sub: "Such as 08:00–22:00. Empty: any time.", kind: "text", ph: "08:00–22:00", off: NO_KEY },
    { t: "Ignore messages that start with", sub: "One per line, such as // or #note.", kind: "lines", off: NO_KEY },
    offSw("Hide people’s chat IDs from the model", false, "IDs become short codes in what the model reads."),
    offSw("Tell me once about each stranger", true, "When someone not allowed writes, you get one note, without their message."),
    { t: "Muted chats", sub: "A muted chat is read but not answered.", kind: "custom", id: "muted" },
    { t: "Take over a chat", sub: "While you answer a chat yourself, the Trunk stays quiet there.", kind: "custom", id: "takeover" },
  ] },
  { title: "Chat commands and rules", lv: 2, rows: [
    { t: "Skip the line", sub: "These are handled at once, even while a task runs.", kind: "custom", id: "code:/stop · /approve" },
    { t: "Pick a model in the chat", sub: "A picker: service, then model. Saved for that chat.", kind: "custom", id: "code:/model" },
    { t: "Who answers here", sub: "Shows which Trunk answers; the owner can switch it, or send one message to a named Trunk.", kind: "text", off: "Chat apps have no command for this yet." },
    { t: "Move this conversation to a chat app", sub: "It carries on there.", kind: "text", off: "Chat apps have no command for this yet." },
    { t: "Memory from a chat", sub: "Shows what is remembered and what waits for review.", kind: "text", off: "Chat apps have no command for this yet." },
    { t: "A plugin off in one group", sub: "Only that group.", kind: "text", off: "Plugins are on or off for every chat; /plugins changes them everywhere." },
    { t: "Links to files expire after", sub: "For apps that fetch a file by its address.", kind: "num", unit: "minutes", def: 60, off: NO_KEY },
    { t: "Wait for quiet before a webhook runs", sub: "A burst of events on one thing runs only the newest.", kind: "num", unit: "s", ph: "Off", off: NO_KEY },
    { t: "A relay sends only to chats it knows", sub: "Messages through a relay go only to chats Branch has heard from.", kind: "custom", id: "relay" },
    { t: "Forward between chats", sub: "Copy messages from one chat to another, from now on, through your filters.", kind: "custom", id: "forward" },
    { t: "Your own commands", sub: "A word that answers with your text, in any chat. Owners only.", kind: "custom", id: "ownCmds" },
  ] },
];
