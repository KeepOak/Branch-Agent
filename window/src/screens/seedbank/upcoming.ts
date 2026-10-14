// Seedbank's "Coming to Branch" kind (R1-15, KeepOak/Branch-Agent-Private#977): the features the owner moved out of the
// main window until they work. Each one used to be a greyed control on its screen; here it is a Coming tile like the
// Adapters, naming where it will live and the engine call it waits for, and it still registers in the dev Coming list.
import type { IconName } from "../../shell/icons";

export type Upcoming = { id: string; name: string; where: string; what: string; icon: IconName; need: string };

export const UPCOMING_COMING = "Arrives in a later update.";

/** In the order a person meets them: a message, the list, Settings, setup, then the message box's + menu. */
export const UPCOMING: readonly Upcoming[] = [
  { id: "message-link", name: "Link to one message", where: "Message menu", what: "Copy a link that opens the conversation at that message.", icon: "link", need: "sessions.messages.link" },
  { id: "message-picture", name: "Share a message as a picture", where: "Message menu", what: "Turn a reply into an image to send anywhere.", icon: "camera", need: "sessions.messages.share" },
  { id: "coding-app", name: "Continue in a coding app", where: "Message menu", what: "Carry a conversation into a coding app on this computer.", icon: "code", need: "sessions.handoff" },
  { id: "folders", name: "Your own folders", where: "The list", what: "Make folders of your own beside All, Unread and the rest.", icon: "folder", need: "sessions.folders.put" },
  { id: "make-default", name: "Make default from search", where: "Settings search", what: "Make a Trunk your default straight from a search result.", icon: "branch", need: "config.patch" },
  { id: "general-more", name: "More General settings", where: "Settings › General", what: "Pinned, Keyboard, Clipboard history, Quick ask, Controllers and Cover the screen.", icon: "gear", need: "config.patch" },
  { id: "another-computer", name: "Run Branch on another computer", where: "Setup", what: "Another computer you own or a home server, paired with a setup code.", icon: "globe", need: "device.pair.setupCode" },
  { id: "keepoak-computer", name: "A KeepOak computer", where: "Setup", what: "Branch always on, in the cloud.", icon: "cloud", need: "environments.create" },
  { id: "screenshot", name: "Screenshot", where: "+ menu", what: "Send what is on your screen.", icon: "camera", need: "desktop.observe" },
  { id: "teach", name: "Teach a task", where: "+ menu", what: "Show Branch a task once and it learns the steps.", icon: "eye", need: "desktop.observe" },
  { id: "office", name: "Write a doc, sheet or slides", where: "+ menu", what: "Start a document, spreadsheet or deck with your Trunk.", icon: "edit", need: "agents.documents.create" },
  { id: "branch-end", name: "Branch from here", where: "+ menu", what: "Start a new conversation from the end of this one.", icon: "branch", need: "sessions.fork" },
  { id: "temporary", name: "Temporary chat", where: "+ menu", what: "A conversation that leaves nothing behind.", icon: "clock", need: "sessions.patch" },
  { id: "check-with-me", name: "Check with me", where: "+ menu", what: "Have the Trunk stop and ask before each step.", icon: "ask", need: "sessions.patch" },
  { id: "phone", name: "Phone call", where: "+ menu › Call", what: "Have your Trunk place a phone call for you.", icon: "phone", need: "voicecall.initiate" },
  { id: "meeting", name: "Join a meeting", where: "+ menu › Call", what: "Have your Trunk join a meeting and take notes.", icon: "users", need: "voicecall.start" },
];
