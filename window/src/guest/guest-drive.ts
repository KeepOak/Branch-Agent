// The Trunk's hands on the owner's browser pane. Each request from the engine runs here against the open tab.
// Pure: the page is a small webview-like interface, so the rules can be tested without Electron.

export type GuestOp = "tabs" | "navigate" | "read" | "act" | "screenshot";

/** Who may drive the pane right now: the owner has not allowed it yet, the owner has the page, or the Trunk may act. */
export type GuestAccess = "allowed" | "needs-consent" | "owner-control";

export const CONSENT_REFUSAL = "Allow the Trunk to use this page first.";
export const OWNER_REFUSAL = "The owner has control of this page.";
export const ADDRESS_REFUSAL = "That address isn't allowed in the browser.";

/** The most characters a read returns; the page text beyond this is cut. */
export const READ_LIMIT = 20000;
/** Screenshots wider than this are shrunk before they are sent. */
export const SHOT_WIDTH = 1280;

export const READ_TEXT_SCRIPT = `(() => { const text = document.body ? document.body.innerText : ""; return String(text || "").slice(0, ${READ_LIMIT}); })()`;
export const READER_TEXT_SCRIPT = `(() => {
  const main = document.querySelector("article") || document.querySelector("main");
  const mainText = main ? String(main.innerText || "").trim() : "";
  if (mainText) return mainText;
  return document.body ? String(document.body.innerText || "") : "";
})()`;

export type GuestImage = {
  toDataURL(): string;
  getSize?(): { width: number; height: number };
  resize?(options: { width: number }): GuestImage;
};

/** The part of an Electron webview the executor uses. */
export type GuestWebview = {
  loadURL(url: string): Promise<void> | void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  getTitle(): string;
  executeJavaScript(code: string): Promise<unknown>;
  sendInputEvent(event: Record<string, unknown>): void;
  insertText(text: string): Promise<void> | void;
  capturePage(): Promise<GuestImage>;
};

export type GuestTabRef = { targetId: string; title: string; url: string };

export type GuestDriveContext = {
  access(): GuestAccess;
  /** The pane's tabs, in order, and which one is showing. */
  tabs(): { tabs: GuestTabRef[]; activeTargetId: string | null };
  /** The showing tab's page, or null when no tab is open. */
  page(): GuestWebview | null;
  /** Opens a tab on the address, for a navigate when no tab is open. */
  openTab(url: string): void;
};

/** A refusal the Trunk can read. Its message is a plain sentence. */
export class GuestRefusal extends Error {}

/** The address a navigate may load: web pages and about:blank only. */
export function guestAddress(raw: string): string | null {
  if (raw === "about:blank") return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Runs one request from the engine and returns its result. Refusals throw GuestRefusal with a plain sentence. */
export async function runGuestRequest(context: GuestDriveContext, op: unknown, args: unknown): Promise<unknown> {
  const access = context.access();
  if (access === "needs-consent") throw new GuestRefusal(CONSENT_REFUSAL);
  if (access === "owner-control") throw new GuestRefusal(OWNER_REFUSAL);
  const input = isRecord(args) ? args : {};
  switch (op) {
    case "tabs":
      return listTabs(context);
    case "navigate":
      return navigate(context, input);
    case "read":
      return readPage(context);
    case "act":
      return act(context, input);
    case "screenshot":
      return screenshot(context);
    default:
      throw new GuestRefusal("The browser doesn't know that request.");
  }
}

function listTabs(context: GuestDriveContext) {
  const { tabs, activeTargetId } = context.tabs();
  return { tabs: tabs.map(({ targetId, title, url }) => ({ targetId, title, url })), activeTargetId };
}

async function navigate(context: GuestDriveContext, args: Record<string, unknown>) {
  const url = guestAddress(textArg(args, "url"));
  if (!url) throw new GuestRefusal(ADDRESS_REFUSAL);
  const page = context.page();
  if (!page) {
    context.openTab(url);
    return { url };
  }
  await settle(page.loadURL(url));
  return { url: page.getURL() };
}

async function readPage(context: GuestDriveContext) {
  const page = requirePage(context);
  const text = await page.executeJavaScript(READ_TEXT_SCRIPT);
  return { url: page.getURL(), title: page.getTitle(), text: typeof text === "string" ? text.slice(0, READ_LIMIT) : "" };
}

async function act(context: GuestDriveContext, args: Record<string, unknown>) {
  const page = requirePage(context);
  switch (textArg(args, "kind")) {
    case "click":
      clickAt(page, args);
      break;
    case "type":
      await typeText(page, args);
      break;
    case "press":
      pressKey(page, args);
      break;
    case "scroll":
      scrollAt(page, args);
      break;
    default:
      throw new GuestRefusal("The browser can't do that to the page.");
  }
  return { url: page.getURL() };
}

async function screenshot(context: GuestDriveContext) {
  const page = requirePage(context);
  const image = shrink(await page.capturePage());
  return { dataUrl: image.toDataURL() };
}

function clickAt(page: GuestWebview, args: Record<string, unknown>): void {
  const x = numberArg(args, "x"), y = numberArg(args, "y");
  if (x === null || y === null) throw new GuestRefusal("Say where on the page to click.");
  const at = { x, y, button: "left", clickCount: 1 };
  page.sendInputEvent({ ...at, type: "mouseDown" });
  page.sendInputEvent({ ...at, type: "mouseUp" });
}

async function typeText(page: GuestWebview, args: Record<string, unknown>): Promise<void> {
  const text = textArg(args, "text");
  if (!text) throw new GuestRefusal("Say what to type.");
  await page.insertText(text);
}

function pressKey(page: GuestWebview, args: Record<string, unknown>): void {
  const key = textArg(args, "key");
  if (!key) throw new GuestRefusal("Say which key to press.");
  page.sendInputEvent({ type: "keyDown", keyCode: key });
  page.sendInputEvent({ type: "keyUp", keyCode: key });
}

function scrollAt(page: GuestWebview, args: Record<string, unknown>): void {
  const dy = numberArg(args, "dy");
  if (dy === null) throw new GuestRefusal("Say how far to scroll.");
  // Without a spot, the wheel turns over the top left corner of the page.
  const x = numberArg(args, "x") ?? 10, y = numberArg(args, "y") ?? 10;
  page.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });
}

function shrink(image: GuestImage): GuestImage {
  const size = image.getSize?.();
  if (!size || !image.resize || size.width <= SHOT_WIDTH) return image;
  return image.resize({ width: SHOT_WIDTH });
}

function requirePage(context: GuestDriveContext): GuestWebview {
  const page = context.page();
  if (!page) throw new GuestRefusal("Open a page first.");
  return page;
}

async function settle(value: Promise<void> | void): Promise<void> {
  try {
    await value;
  } catch {
    // A page that fails to load still shows its own error page; the address is what the Trunk asked for.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
