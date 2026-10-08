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

const WORDS_BY_LABEL = new Map<string, Words>();
for (const words of Object.values(COMPUTER_ACTION_WORDS)) {
  WORDS_BY_LABEL.set(words.now, words);
  WORDS_BY_LABEL.set(words.done, words);
}

const RAW_ACTION = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const RAW_ACTION_IN_TEXT = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

function pick(words: Words, status?: StepStatus): string {
  return status === "running" ? words.now : words.done;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Computer / screen / desktop tools, not the browser card. */
export function isComputerToolName(tool: string): boolean {
  return /computer|screen|desktop/i.test(tool) && !/browser/i.test(tool);
}

/** An underscored internal name, or a known computer action id. */
export function isRawComputerAction(value: string): boolean {
  const key = value.trim();
  return Boolean(COMPUTER_ACTION_WORDS[key]) || RAW_ACTION.test(key);
}

/** One action name → readable words. Unknown snake_case never leaks through. */
export function computerActionLabel(action: string, status?: StepStatus): string {
  const key = action.trim();
  if (!key) return pick(FALLBACK, status);
  if (COMPUTER_ACTION_WORDS[key]) return pick(COMPUTER_ACTION_WORDS[key], status);
  const labeled = WORDS_BY_LABEL.get(key);
  if (labeled) return pick(labeled, status);
  return pick(FALLBACK, status);
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

function actionFromStep(step: Pick<StepBits, "title" | "input">): string {
  const title = step.title.trim();
  if (COMPUTER_ACTION_WORDS[title] || isRawComputerAction(title)) return title;
  return actionFromInput(step.input);
}

/** Words for a computer step's title (history may still store a raw action name). */
export function computerStepTitle(step: Pick<StepBits, "title" | "input" | "status">): string {
  const title = step.title.trim();
  const labeled = WORDS_BY_LABEL.get(title);
  if (labeled) return pick(labeled, step.status);
  const action = actionFromStep(step);
  if (action) return computerActionLabel(action, step.status);
  return title;
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
  const labeled = WORDS_BY_LABEL.get(title);
  if (labeled) return undefined;
  return title;
}

export function computerStepWords(step: Pick<StepBits, "title" | "input" | "status">): Words {
  const title = step.title.trim();
  const labeled = WORDS_BY_LABEL.get(title) ?? COMPUTER_ACTION_WORDS[title];
  if (labeled) return labeled;
  const action = actionFromStep(step);
  if (action && COMPUTER_ACTION_WORDS[action]) return COMPUTER_ACTION_WORDS[action];
  if (action && isRawComputerAction(action)) return FALLBACK;
  return FALLBACK;
}
