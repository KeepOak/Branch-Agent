// Light, dark or follow the computer (DESIGN-SPEC §2, §3.2 light/dark button). The choice is applied
// before the first draw so the window never flashes the wrong colours (§2.2 Parity adds, theme-bootstrap).
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "branch.theme";

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system"; // storage blocked: follow the computer
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
  window.dispatchEvent(new CustomEvent("branch:theme-change", {detail: choice}));
}

export function applySavedTheme(): void {
  applyTheme(readThemeChoice());
}

/** The mode the window shows now, resolving "system" through the computer's setting. */
export function effectiveDark(choice: ThemeChoice): boolean {
  if (choice !== "system") {
    return choice === "dark";
  }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Saves and applies a choice (the person menu's Look: Light, Dark or Auto). */
export function setThemeChoice(choice: ThemeChoice): ThemeChoice {
  try {
    if (choice === "system") {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, choice);
    }
  } catch {
    // storage blocked: the choice lasts for this window only
  }
  applyTheme(choice);
  return choice;
}

/** The light/dark button flips the shown mode and saves it. */
export function toggleTheme(choice: ThemeChoice): ThemeChoice {
  const next: ThemeChoice = effectiveDark(choice) ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // storage blocked: the choice lasts for this window only
  }
  applyTheme(next);
  return next;
}
