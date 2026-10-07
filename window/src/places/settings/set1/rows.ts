// The rows each set1 page shows, for the settings search (§4.7.0 Searching): exact titles, their section, their level.
import type { RowEntry } from "../kit";

const rows = (page: string, sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page, title, sec, group: sec.replace(/, (more|technical|in depth)$/, ""), lv }));

export const ACCOUNTS_ROWS: RowEntry[] = [
  ...rows("accounts", "Order Branch uses them in", 0, []),
  ...rows("accounts", "Coding apps on this computer", 0, ["Use Claude Code", "Use Codex", "Use Gemini CLI"]),
  ...rows("accounts", "GitHub", 0, ["GitHub"]),
  ...rows("accounts", "When one runs out", 0, ["Move to the next account in the list", "Fall back to this computer"]),
  ...rows("accounts", "Terms", 1, ["Each service’s terms"]),
  ...rows("accounts", "Accounts", 1, ["Which account each Trunk uses", "Helpers keep their account", "Pick by what the task needs", "Fallback keys", "Resting now", "Which sign-in each request used", "Organisation", "A customer’s ChatGPT account on a KeepOak computer"]),
  ...rows("accounts", "Which account goes next", 2, ["Which account goes next"]),
  ...rows("accounts", "Where each sign-in comes from", 2, ["Where each sign-in comes from"]),
  ...rows("accounts", "Accounts, technical", 2, ["This Branch’s identity", "Use a model from a hub for one run", "Install a service’s package when needed", "Point your coding apps at Branch", "A command that makes a sign-in", "On a build server, sign in with", "Accept sign-ins from your editor", "Sign-ins through the Gateway", "Settings from another Branch", "Keep service settings in step on my devices", "Region", "Each account keeps its own folder"]),
];
