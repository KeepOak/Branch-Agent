/** One path when nothing can answer: send is allowed, and the reply names what to do. */
export const CONNECT_MODEL_ANSWERS = "Connect a model to get answers";
export const CONNECT_MODEL_ACTION = "Connect a model";
export const NO_MODEL_SETUP = "No model is set up";
/** Your models, when this computer has none. Never promises a free local model that may not exist. */
export const NO_MODELS_ONBOARDING = "No models on this computer yet. Connect a model to get answers.";

/** Engine failures that mean no usable model, never shown as raw errors. */
const NO_USABLE_MODEL =
  /No API key (?:found|resolved) for provider|Missing bearer or basic authentication|no usable model account|CodexNotInstalled|Install and sign in to Codex|could not verify a usable inference route|requires working inference|No model is set up|isn['’]t ready on this computer yet/i;

export function isNoUsableModelError(message: string): boolean {
  return message.includes(CONNECT_MODEL_ANSWERS) || NO_USABLE_MODEL.test(message);
}

/** Map a send or Make-a-Trunk failure to the same words, or leave other errors alone. */
export function friendlyModelError(message: string): string {
  return isNoUsableModelError(message) ? CONNECT_MODEL_ANSWERS : message;
}

export function inferenceProblem(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return isNoUsableModelError(message) ? CONNECT_MODEL_ANSWERS : null;
}

/** #589: a ChatGPT model is connected, but Codex, which runs its turns, isn't on this computer. Add an account
 *  can't fix that, so the thread names what's missing and opens Settings › Accounts, where the Codex row offers
 *  Get Codex or Check again. */
export const CODEX_MISSING = "Codex isn’t on this computer yet. Your ChatGPT account is connected, but its models need Codex to answer. Set up Codex in Settings › Accounts, then try again.";
export const CODEX_MISSING_ACTION = "Set up Codex";
const CODEX_MISSING_ERROR = /CodexNotInstalled|Install and sign in to Codex/i;

export function isCodexMissingError(message: string): boolean {
  return CODEX_MISSING_ERROR.test(message);
}

/** Opens Settings › Accounts (its Coding apps rows) without the Add an account dialog. */
export function openCodexSetup(): void {
  window.dispatchEvent(new CustomEvent("branch:navigate-settings", { detail: { page: "accounts" } }));
}

/** Opens Add an account from a thread, Trunk studio, or settings row. */
export function openConnectModel(): void {
  sessionStorage.setItem("branch.openAddAccount", "1");
  window.dispatchEvent(new CustomEvent("branch:navigate-settings", { detail: { page: "accounts" } }));
  // Accounts already on screen listens for this and opens the dialog without a remount.
  window.dispatchEvent(new CustomEvent("branch:open-add-account"));
}
