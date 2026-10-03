// The rows each set1 page shows, for the settings search (§4.7.0 Searching): exact titles, their section, their level.
import type { RowEntry } from "../kit";

const rows = (page: string, sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page, title, sec, lv }));

export const ACCOUNTS_ROWS: RowEntry[] = [
  ...rows("accounts", "Order Branch uses them in", 0, []),
  ...rows("accounts", "Coding apps on this computer", 0, ["Claude Code", "Codex", "Gemini CLI"]),
  ...rows("accounts", "When one runs out", 0, ["Move to the next account in the list", "Fall back to this computer"]),
  ...rows("accounts", "Terms", 1, ["Each service’s terms"]),
  ...rows("accounts", "Accounts, more", 1, ["Which account each Trunk uses", "Helpers keep their account", "Pick by what the task needs", "Fallback keys", "Resting now", "Which sign-in each request used", "Organisation", "A customer’s ChatGPT plan on a KeepOak computer"]),
  ...rows("accounts", "Accounts, technical", 2, ["A command that makes a sign-in", "On a build server, sign in with", "Accept sign-ins from your editor", "Sign-ins through the Gateway", "Settings from another Branch", "Keep service settings in step on my devices", "Region", "Each account keeps its own folder"]),
];
