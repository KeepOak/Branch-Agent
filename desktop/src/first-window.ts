// The first window a cold start shows (Private #1094). Component install and engine startup keep going
// behind it, and the page says which of those is in progress. The real app replaces this page once its files exist.

/** A cold start must reach this window within this long. */
export const USABLE_WINDOW_LIMIT_MS = 10_000;

export type FirstWindowPhase = "opening" | "installing";

const LABELS: Record<FirstWindowPhase, string> = {
  opening: "Opening Branch…",
  installing: "Installing Branch…",
};

export function firstWindowLabel(phase: FirstWindowPhase): string {
  return LABELS[phase];
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A real window, with a status line and a moving bar, not a frozen splash. */
export function firstWindowDocument(phase: FirstWindowPhase): string {
  const label = escapeHtml(firstWindowLabel(phase));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Branch Agent</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#f6f7f8;color:#333;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-app-region:drag}
main{width:min(420px,calc(100vw - 48px))}
h1{font-size:22px;font-weight:600;margin:0 0 8px}
p{margin:0 0 16px}
.bar{height:4px;background:#e1e3e6;border-radius:999px;overflow:hidden}
.bar>span{display:block;height:100%;width:35%;background:#2f6f4e;animation:slide 1.1s ease-in-out infinite}
@keyframes slide{from{transform:translateX(-120%)}to{transform:translateX(320%)}}
</style></head><body><main data-usable-window="1"><h1>Branch Agent</h1><p id="startup-status" role="status">${label}</p><div class="bar" role="progressbar" aria-label="Starting Branch"><span></span></div></main></body></html>`;
}

export function firstWindowUrl(phase: FirstWindowPhase): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(firstWindowDocument(phase))}`;
}
