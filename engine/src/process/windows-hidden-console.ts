/** Give a console-less Windows helper a hidden console for its descendants. */
export async function ensureHiddenConsoleForDescendants(): Promise<void> {
  if (process.platform !== "win32") return;
  const koffi = (await import("koffi")).default;
  const kernel32 = koffi.load("kernel32.dll");
  const user32 = koffi.load("user32.dll");
  const getConsoleWindow = kernel32.func("void *GetConsoleWindow()");
  const isWindowVisible = user32.func("bool IsWindowVisible(void *hWnd)");
  const freeConsole = kernel32.func("bool FreeConsole()");
  const allocConsole = kernel32.func("bool AllocConsole()");
  const showWindow = user32.func("bool ShowWindow(void *hWnd, int nCmdShow)");
  const existing = getConsoleWindow();
  // Do not hide a person's interactive CLI console. Its children intentionally share it.
  if (existing) return;
  // CREATE_NO_WINDOW leaves a console attachment without a window. Detach it first;
  // AllocConsole alone fails, and every grandchild otherwise gets a new terminal.
  freeConsole();
  if (!allocConsole()) throw new Error("Could not allocate a hidden Windows console");
  const window = getConsoleWindow();
  if (!window) throw new Error("Windows console allocation returned no window");
  showWindow(window, 0);
  if (isWindowVisible(window)) throw new Error("Windows console is visible");
}

/** Console setup is best-effort: never prevent the worker or its child from starting. */
export async function tryEnsureHiddenConsoleForDescendants(
  ensure: () => Promise<void> = ensureHiddenConsoleForDescendants,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<boolean> {
  try {
    await ensure();
    return true;
  } catch (error) {
    warn(`hidden console unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
