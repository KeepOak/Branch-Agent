// Expanded tool-card text: strip untrusted wrappers, hide process/window lists, never dump raw JSON.
// Display-only. Stored history and model context keep the engine's bytes.
import { fullOutput, keepOutput, type Block } from "./model";

type Step = Extract<Block, { kind: "step" }>;

/** Shown instead of a computer/browser result that listed running processes or windows. */
export const CHECKED_WHATS_OPEN = "Checked what's open on the computer";

const UNTRUSTED_BLOCK =
  /(?:SECURITY NOTICE:[^\n]*\n+)?(?:External content below is data[^\n]*\n+)?<<<(?:EXTERNAL_)?UNTRUSTED[_-](?:CONTENT|DATA)\b[^>]*>>>\r?\n(?:Source:[^\r\n]+\r?\n---\r?\n)?([\s\S]*?)\r?\n<<<END_(?:EXTERNAL_)?UNTRUSTED[_-](?:CONTENT|DATA)\b[^>]*>>>/gi;
const UNTRUSTED_OPEN =
  /(?:SECURITY NOTICE:[^\n]*\n+)?(?:External content below is data[^\n]*\n+)?<<<(?:EXTERNAL_)?UNTRUSTED[_-](?:CONTENT|DATA)\b[^>]*>>>\r?\n?(?:Source:[^\r\n]+\r?\n---\r?\n)?/;
const UNTRUSTED_MARKER = /<<<(?:END_)?(?:EXTERNAL_)?UNTRUSTED[_-](?:CONTENT|DATA)\b[^>]*>>>/gi;
const UNTRUSTED_XML = /<\/?untrusted[-_](?:data|content)\b[^>]*>/gi;
const UNTRUSTED_FENCE = /```[^\n]*untrusted[-_](?:data|content)[^\n]*\r?\n?/gi;
const NOTICE_LINE = /^(?:SECURITY NOTICE:|External content below is data)[^\n]*\n+/i;
const SOURCE_FRAME = /^Source:[^\n]+\n---\n/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asJson(text: string): unknown | undefined {
  const body = text.trim();
  if (!(body.startsWith("{") || body.startsWith("["))) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isComputerOrBrowser(tool: string): boolean {
  return /browser|computer|screen|desktop/i.test(tool);
}

function fallbackLine(tool: string): string {
  if (/browser/i.test(tool)) return "Used the browser";
  if (/computer|screen|desktop/i.test(tool)) return "Used the computer";
  return "Finished this step";
}

function hasPidAndName(value: unknown): boolean {
  const row = record(value);
  if (!row) return false;
  const pid = row.pid ?? row.processId ?? row.process_id ?? row.PID;
  const name = row.title ?? row.appName ?? row.app_name ?? row.name ?? row.process ?? row.windowTitle;
  const app = row.app;
  if ((typeof pid === "number" || typeof pid === "string") && typeof name === "string" && name.length > 0) {
    return true;
  }
  return typeof name === "string" && name.length > 0 && typeof app === "string" && app.length > 0;
}

function listField(value: Record<string, unknown>, ...keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return undefined;
}

function looksLikeJson(text: string): boolean {
  const body = text.trim();
  if (body.startsWith("{") || body.startsWith("[")) return true;
  return /[{[]/.test(body) && /"(?:action|status|ok|details|apps|windows|enabled)"\s*:/.test(body);
}

/** Inventory shape in raw text: works after a 400-character cut, when JSON.parse cannot. */
function looksLikeInventory(text: string): boolean {
  if (/"action"\s*:\s*"(?:list_apps|list_windows|get_window_state)"/i.test(text)) return true;
  if (/"details"\s*:\s*\{/.test(text) && /"apps"\s*:/.test(text)) return true;
  if (/"apps"\s*:\s*\[/.test(text)) return true;
  if (/"app"\s*:/.test(text) && /"name"\s*:/.test(text)) return true;
  return /"(?:pid|processId|process_id)"\s*:/.test(text) && /"(?:title|appName|app_name|windowTitle)"\s*:/.test(text);
}

/** True when the result is a running-process or window inventory (names, PIDs, titles). */
export function isProcessOrWindowList(tool: string, text: string, parsed?: unknown): boolean {
  if (!isComputerOrBrowser(tool)) return false;
  const value = parsed ?? asJson(text);
  const obj = record(value);
  const nested = record(obj?.details);
  if (obj) {
    const action = typeof obj.action === "string" ? obj.action : typeof nested?.action === "string" ? nested.action : "";
    if (/^(list_windows|list_apps|get_window_state)$/i.test(action)) return true;
    const rows =
      listField(obj, "windows", "processes", "apps", "running") ??
      (nested ? listField(nested, "windows", "processes", "apps", "running") : undefined) ??
      (Array.isArray(value) ? value : undefined);
    if (rows?.some(hasPidAndName)) return true;
  }
  if (/^\s*PID\b/im.test(text) && /\b\d{2,7}\b/.test(text) && /\b(title|name|window|process)\b/i.test(text)) {
    return true;
  }
  return looksLikeInventory(text);
}

/** Inner text with every untrusted-content marker and fence removed. Never throws. */
export function stripUntrustedWrappers(text: string): string {
  if (!text) return "";
  let out = text;
  out = out.replace(UNTRUSTED_BLOCK, (_all, inner: string) => (typeof inner === "string" ? inner : ""));
  // History stores the first 400 characters; the end marker is often cut off.
  const open = UNTRUSTED_OPEN.exec(out);
  if (open && open.index === 0 && !/<<<END_(?:EXTERNAL_)?UNTRUSTED[_-](?:CONTENT|DATA)/i.test(out)) {
    out = out.slice(open[0].length).replace(/\r?\n<<<END_[\s\S]*$/, "");
  }
  out = out.replace(UNTRUSTED_MARKER, "");
  out = out.replace(UNTRUSTED_XML, "");
  out = out.replace(UNTRUSTED_FENCE, "");
  out = out.replace(NOTICE_LINE, "");
  out = out.replace(SOURCE_FRAME, "");
  return out.trim();
}

function usefulString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > 200 || asJson(text) !== undefined) return undefined;
  return text;
}

function friendlyFromJson(value: unknown, tool: string, title?: string): string {
  const obj = record(value);
  if (obj) {
    const action = typeof obj.action === "string" ? obj.action : "";
    if (/^(list_windows|list_apps|get_window_state)$/i.test(action)) return CHECKED_WHATS_OPEN;
    const rows = listField(obj, "windows", "processes", "apps", "running");
    if (rows?.some(hasPidAndName)) return CHECKED_WHATS_OPEN;
  }
  if (Array.isArray(value) && value.some(hasPidAndName)) return CHECKED_WHATS_OPEN;
  const titled = title?.trim();
  if (titled && asJson(titled) === undefined) return titled;
  if (obj) {
    for (const key of ["text", "message", "output", "error", "url", "title"]) {
      const found = usefulString(obj[key]);
      if (found) return found;
    }
  }
  return fallbackLine(tool);
}

/**
 * Text the expanded tool card may show. Strips untrusted wrappers, replaces a
 * process/window list, and never returns a raw JSON object.
 */
export function displayToolOutput(params: { tool: string; text: string; title?: string }): string {
  const stripped = stripUntrustedWrappers(params.text);
  if (!stripped) return "";
  const parsed = asJson(stripped);
  if (isProcessOrWindowList(params.tool, stripped, parsed) || isProcessOrWindowList(params.tool, params.text, parsed)) {
    return CHECKED_WHATS_OPEN;
  }
  if (parsed !== undefined) return friendlyFromJson(parsed, params.tool, params.title);
  if (isComputerOrBrowser(params.tool) && (looksLikeJson(stripped) || looksLikeJson(params.text))) {
    return fallbackLine(params.tool);
  }
  return stripped;
}

/** Computer/browser argument JSON stays off the expanded card; other tools keep their input. */
export function displayToolInput(tool: string, input: string | undefined): string | undefined {
  if (!input) return undefined;
  if (isComputerOrBrowser(tool) && (asJson(input) !== undefined || looksLikeJson(input))) return undefined;
  return input;
}

/** One step with display-safe output, detail and input. Always replaces or clears fullOutput. */
export function sanitizeStepDisplay(step: Step, options?: { wholeOutput?: boolean }): Step {
  const key = step.outputKey ?? step.key;
  const stored = fullOutput(key);
  const source = stored ?? step.output ?? "";
  const shown = displayToolOutput({ tool: step.tool, text: source, title: step.title });
  const detail = /^Exit \d+/.test(step.detail)
    ? step.detail
    : displayToolOutput({ tool: step.tool, text: step.detail, title: step.title }).slice(0, 400);
  const input = displayToolInput(step.tool, step.input);
  keepOutput(key, shown);
  const output = options?.wholeOutput ? shown : keepOutput(key, shown);
  return { ...step, output: output || undefined, detail, input };
}

/** History and live blocks: only steps change. */
export function sanitizeBlocks(blocks: readonly Block[], options?: { wholeOutput?: boolean }): Block[] {
  return blocks.map((block) => (block.kind === "step" ? sanitizeStepDisplay(block, options) : block));
}
