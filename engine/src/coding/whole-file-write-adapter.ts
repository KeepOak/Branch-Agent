import { parseWholeFileEdits, type WholeFileEdit } from "./whole-file-edits.ts";

/** Bind the already-admitted native write tool; this adapter grants no file access. */
export interface WholeFileWriteTool {
  execute(callId: string, args: { path: string; content: string }, signal?: AbortSignal): Promise<{ isError?: boolean }>;
}

/** Aider apply_edits, routed through the caller's canonical guarded write tool. */
export async function applyWholeFileResponse(
  content: string,
  chatFiles: readonly string[],
  writeTool: WholeFileWriteTool,
  options: { callId: string; fence?: readonly [string, string]; signal?: AbortSignal },
): Promise<WholeFileEdit[]> {
  const edits = parseWholeFileEdits(content, chatFiles, options.fence);
  for (const [index, edit] of edits.entries()) {
    options.signal?.throwIfAborted();
    const result = await writeTool.execute(`${options.callId}:${index}`, { path: edit.path, content: edit.content }, options.signal);
    if (result.isError) throw new Error(`Whole-file write failed for ${edit.path}`);
    options.signal?.throwIfAborted();
  }
  return edits;
}

/** ID-scoped Continue cancellation, composed with the caller's existing run signal. */
export async function applyWholeFileResponseWithController(
  content: string,
  chatFiles: readonly string[],
  writeTool: WholeFileWriteTool,
  options: { callId: string; fence?: readonly [string, string]; signal?: AbortSignal },
  manager: { get(id: string): AbortController; release(id: string, controller: AbortController): void },
): Promise<WholeFileEdit[]> {
  const controller = manager.get(options.callId);
  const applySignal = controller.signal;
  const signal = options.signal ? AbortSignal.any([options.signal, applySignal]) : applySignal;
  try {
    return await applyWholeFileResponse(content, chatFiles, writeTool, { ...options, signal });
  } finally {
    manager.release(options.callId, controller);
  }
}
