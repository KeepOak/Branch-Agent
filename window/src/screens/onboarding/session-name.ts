// The name from Welcome, kept on this computer so greetings can use it after Branch
// restarts even when the connection has no profile yet (users.setDisplayName has
// nothing to write). sessionStorage dies with the window; localStorage does not.
const KEY = "branch.sessionDisplayName";

/** Remember the name typed during setup. Empty clears it. Never throws. */
export function rememberSessionName(name: string): void {
  const who = name.trim();
  try {
    if (who) localStorage.setItem(KEY, who);
    else localStorage.removeItem(KEY);
  } catch {
    // greetings still work; they ask what to call you
  }
}

/** The name remembered on this computer, or "". */
export function recalledSessionName(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}
