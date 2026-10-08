// Plain words for computer-tool actions. Raw snake_case names never show.

type Words = { now: string; done: string };
type StepStatus = "running" | "ok" | "failed" | "denied";
type StepBits = { title: string; input?: string; status?: StepStatus };

/** Every computer-tool action the engine defines, plus common aliases. */
const COMPUTER_ACTION_WORDS: Record<string, Words> = {
  screenshot: { now: "Taking a screenshot", done: "Took a screenshot" },
  left_click: { now: "Clicking", done: "Clicked" },
  right_click: { now: "Right-clicking", done: "Right-clicked" },
  middle_click: { now: "Middle-clicking", done: "Middle-clicked" },
  double_click: { now: "Double-clicking", done: "Double-clicked" },
  triple_click: { now: "Triple-clicking", done: "Triple-clicked" },
  mouse_move: { now: "Moving the pointer", done: "Moved the pointer" },
  left_click_drag: { now: "Dragging", done: "Dragged" },
  left_mouse_down: { now: "Pressing the mouse", done: "Pressed the mouse" },
  left_mouse_up: { now: "Releasing the mouse", done: "Released the mouse" },
  scroll: { now: "Scrolling", done: "Scrolled" },
  type: { now: "Typing text", done: "Typed text" },
  key: { now: "Pressing a key", done: "Pressed a key" },
  hold_key: { now: "Holding a key", done: "Held a key" },
  wait: { now: "Waiting", done: "Waited" },
  list_apps: { now: "Listing open apps", done: "Listed open apps" },
  list_windows: { now: "Listing open windows", done: "Listed open windows" },
  get_accessibility_tree: { now: "Reading the screen layout", done: "Read the screen layout" },
  get_cursor_position: { now: "Finding the pointer", done: "Found the pointer" },
  get_window_state: { now: "Checking a window", done: "Checked a window" },
  launch_app: { now: "Opening an app", done: "Opened an app" },
  kill_app: { now: "Closing an app", done: "Closed an app" },
  bring_to_front: { now: "Switching windows", done: "Switched windows" },
  set_value: { now: "Setting a value", done: "Set a value" },
  zoom: { now: "Zooming", done: "Zoomed" },
  get_browser_state: { now: "Checking the browser", done: "Checked the browser" },
  browser_prepare: { now: "Preparing the browser", done: "Prepared the browser" },
  browser_navigate: { now: "Opening a page", done: "Opened a page" },
  browser_click: { now: "Clicking in the browser", done: "Clicked in the browser" },
  browser_type: { now: "Typing in the browser", done: "Typed in the browser" },
  browser_dialog: { now: "Using a browser dialog", done: "Used a browser dialog" },
  browser_set_input_files: { now: "Adding files", done: "Added files" },
  browser_download: { now: "Downloading a file", done: "Downloaded a file" },
  browser_pointer: { now: "Using the pointer", done: "Used the pointer" },
  escalate_scope: { now: "Asking for more access", done: "Asked for more access" },
  get_recording_state: { now: "Checking recording", done: "Checked recording" },
  start_recording: { now: "Starting recording", done: "Started recording" },
  stop_recording: { now: "Stopping recording", done: "Stopped recording" },
  replay_trajectory: { now: "Replaying a recording", done: "Replayed a recording" },
  invoke_menu: { now: "Opening a menu", done: "Opened a menu" },
  take_control: { now: "Taking control", done: "Took control" },
  click: { now: "Clicking", done: "Clicked" },
  focus_window: { now: "Switching windows", done: "Switched windows" },
};

const FALLBACK: Words = { now: "Using the computer", done: "Used the computer" };

/** Every action the screen tool defines (`engine/src/agents/tools/screen-tool.ts`). */
const SCREEN_ACTION_WORDS: Record<string, Words> = {
  split_right: { now: "Splitting the screen", done: "Split the screen" },
  split_down: { now: "Splitting the screen down", done: "Split the screen down" },
  close_pane: { now: "Closing a pane", done: "Closed a pane" },
  focus: { now: "Focusing a pane", done: "Focused a pane" },
  sidebar_show: { now: "Showing the sidebar", done: "Showed the sidebar" },
  sidebar_hide: { now: "Hiding the sidebar", done: "Hid the sidebar" },
  terminal_show: { now: "Showing the terminal", done: "Showed the terminal" },
  terminal_hide: { now: "Hiding the terminal", done: "Hid the terminal" },
  browser_show: { now: "Showing the browser", done: "Showed the browser" },
  browser_hide: { now: "Hiding the browser", done: "Hid the browser" },
  desktop_show: { now: "Showing the desktop", done: "Showed the desktop" },
  desktop_hide: { now: "Hiding the desktop", done: "Hid the desktop" },
  portal_show: { now: "Showing a portal", done: "Showed a portal" },
  portal_hide: { now: "Hiding a portal", done: "Hid a portal" },
  navigate: { now: "Opening a view", done: "Opened a view" },
};

const SCREEN_FALLBACK: Words = { now: "Using the screen", done: "Used the screen" };

const WORDS_BY_LABEL = new Map<string, Words>();
for (const words of Object.values(COMPUTER_ACTION_WORDS)) {
  WORDS_BY_LABEL.set(words.now, words);
  WORDS_BY_LABEL.set(words.done, words);
}
const SCREEN_WORDS_BY_LABEL = new Map<string, Words>();
for (const words of Object.values(SCREEN_ACTION_WORDS)) {
  SCREEN_WORDS_BY_LABEL.set(words.now, words);
  SCREEN_WORDS_BY_LABEL.set(words.done, words);
}

const RAW_ACTION = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const RAW_ACTION_IN_TEXT = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

function pick(words: Words, status?: StepStatus): string {
  return status === "running" ? words.now : words.done;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function lastToolId(tool: string): string {
  return (tool.split(/__|\./).filter(Boolean).pop() ?? tool).trim().toLowerCase();
}

/** The computer tool only (`computer`, `plugin.computer`), never `screen` or `desktop`. */
export function isComputerToolName(tool: string): boolean {
  return lastToolId(tool) === "computer";
}

/** The presentation `screen` tool (`engine/src/agents/tools/screen-tool.ts`). */
export function isScreenToolName(tool: string): boolean {
  return lastToolId(tool) === "screen";
}

/** An underscored internal name, or a known computer or screen action id. */
export function isRawComputerAction(value: string): boolean {
  const key = value.trim();
  return Boolean(COMPUTER_ACTION_WORDS[key]) || Boolean(SCREEN_ACTION_WORDS[key]) || RAW_ACTION.test(key);
}

function labelFrom(
  map: Record<string, Words>,
  byLabel: Map<string, Words>,
  fallback: Words,
  action: string,
  status?: StepStatus,
): string {
  const key = action.trim();
  if (!key) return pick(fallback, status);
  if (map[key]) return pick(map[key], status);
  const labeled = byLabel.get(key);
  if (labeled) return pick(labeled, status);
  return pick(fallback, status);
}

/** One action name → readable words. Unknown snake_case never leaks through. */
export function computerActionLabel(action: string, status?: StepStatus): string {
  return labelFrom(COMPUTER_ACTION_WORDS, WORDS_BY_LABEL, FALLBACK, action, status);
}

/** One screen-tool action → readable words. Unknown names never leak snake_case. */
export function screenActionLabel(action: string, status?: StepStatus): string {
  return labelFrom(SCREEN_ACTION_WORDS, SCREEN_WORDS_BY_LABEL, SCREEN_FALLBACK, action, status);
}

function actionFromInput(input: string | undefined): string {
  if (!input) return "";
  try {
    const value = record(JSON.parse(input) as unknown);
    const nested = record(value.args);
    const action = value.action ?? nested.action;
    return typeof action === "string" ? action : "";
  } catch {
    return "";
  }
}

function actionFromStep(step: Pick<StepBits, "title" | "input">, map: Record<string, Words>): string {
  const title = step.title.trim();
  if (map[title] || isRawComputerAction(title)) return title;
  return actionFromInput(step.input);
}

function stepTitleFrom(
  map: Record<string, Words>,
  byLabel: Map<string, Words>,
  fallback: Words,
  step: Pick<StepBits, "title" | "input" | "status">,
): string {
  const title = step.title.trim();
  const labeled = byLabel.get(title);
  if (labeled) return pick(labeled, step.status);
  const action = actionFromStep(step, map);
  if (action) return labelFrom(map, byLabel, fallback, action, step.status);
  return title;
}

/** Words for a computer step's title (history may still store a raw action name). */
export function computerStepTitle(step: Pick<StepBits, "title" | "input" | "status">): string {
  return stepTitleFrom(COMPUTER_ACTION_WORDS, WORDS_BY_LABEL, FALLBACK, step);
}

/** Words for a screen-tool step's title. */
export function screenStepTitle(step: Pick<StepBits, "title" | "input" | "status">): string {
  return stepTitleFrom(SCREEN_ACTION_WORDS, SCREEN_WORDS_BY_LABEL, SCREEN_FALLBACK, step);
}

/** Computer or screen step title; other tools keep their own title. */
export function plainStepTitle(step: Pick<StepBits, "title" | "input" | "status"> & { tool: string }): string {
  if (isScreenToolName(step.tool)) return screenStepTitle(step);
  if (isComputerToolName(step.tool)) return computerStepTitle(step);
  return step.title;
}

/** A caption the card may show: drop leftover raw action names. */
export function computerSafeCaption(detail: string | undefined): string | undefined {
  const text = detail?.trim() ?? "";
  if (!text || isRawComputerAction(text) || RAW_ACTION_IN_TEXT.test(text)) return undefined;
  return text;
}

/** The muted step-row detail: human titles only, never a raw action name. */
export function computerStepDetail(step: Pick<StepBits, "title" | "input" | "status">, label: string): string | undefined {
  const title = step.title.trim();
  if (!title || isRawComputerAction(title)) return undefined;
  if (title === label) return undefined;
  const labeled = WORDS_BY_LABEL.get(title) ?? SCREEN_WORDS_BY_LABEL.get(title);
  if (labeled) return undefined;
  return title;
}

function stepWordsFrom(
  map: Record<string, Words>,
  byLabel: Map<string, Words>,
  fallback: Words,
  step: Pick<StepBits, "title" | "input" | "status">,
): Words {
  const title = step.title.trim();
  const labeled = byLabel.get(title) ?? map[title];
  if (labeled) return labeled;
  const action = actionFromStep(step, map);
  if (action && map[action]) return map[action];
  if (action && isRawComputerAction(action)) return fallback;
  return fallback;
}

export function computerStepWords(step: Pick<StepBits, "title" | "input" | "status">): Words {
  return stepWordsFrom(COMPUTER_ACTION_WORDS, WORDS_BY_LABEL, FALLBACK, step);
}

export function screenStepWords(step: Pick<StepBits, "title" | "input" | "status">): Words {
  return stepWordsFrom(SCREEN_ACTION_WORDS, SCREEN_WORDS_BY_LABEL, SCREEN_FALLBACK, step);
}
