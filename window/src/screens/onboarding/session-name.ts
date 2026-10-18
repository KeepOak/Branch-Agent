// The name from Welcome, kept for this window so greetings can use it even when
// the connection has no profile yet (users.setDisplayName has nothing to write).
const KEY = "branch.sessionDisplayName";

/** Remember the name typed during setup. Empty clears it. Never throws. */
export function rememberSessionName(name: string): void {
  const who = name.trim();
  try {
    if (who) sessionStorage.setItem(KEY, who);
    else sessionStorage.removeItem(KEY);
  } catch {
    // current window only
  }
}

/** The name remembered this session, or "". */
export function recalledSessionName(): string {
  try {
    return sessionStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}
