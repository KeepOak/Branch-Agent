// Adapted from bytedance/UI-TARS-desktop@2ff41a9e515828c5bd5b276e493d73aa0bdf4a3a:
// multimodal/tarko/agent-ui/src/common/hooks/useReplay.ts and standalone/replay/ReplayControlPanel.tsx (SESSIONS-0127).
/** This function is embedded in the exported file and must have no module dependencies. */
export function installReplay(): void {
  const container = document.getElementById("branch-replay-events");
  const timeline = document.querySelector<HTMLInputElement>("#branch-replay-position");
  const play = document.querySelector<HTMLButtonElement>("#branch-replay-play");
  const progress = document.getElementById("branch-replay-progress");
  if (!container || !timeline || !play || !progress) return;
  const events = Array.from(container.children) as HTMLElement[];
  const speeds = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-replay-speed]"));
  let at = -1, playing = false, speed = 1;
  let timer: ReturnType<typeof setInterval> | undefined;
  const render = () => {
    events.forEach((event, index) => { event.hidden = index > at; });
    timeline.value = String(events.length > 1 ? Math.max(0, at) / (events.length - 1) : 0);
    progress.textContent = `${at + 1} of ${events.length}`;
    play.textContent = playing ? "Pause" : "Play";
    speeds.forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.replaySpeed) === speed)));
  };
  const pause = () => { clearInterval(timer); timer = undefined; playing = false; render(); };
  const start = () => {
    clearInterval(timer);
    if (!events.length || at >= events.length - 1) { pause(); return; }
    playing = true; render();
    timer = setInterval(() => { at += 1; if (at >= events.length - 1) pause(); else render(); }, Math.max(200, 800 / speed));
  };
  play.addEventListener("click", () => { if (playing) pause(); else start(); });
  timeline.addEventListener("input", () => {
    at = Math.floor(Math.max(0, Math.min(1, Number(timeline.value))) * (events.length - 1)); pause();
  });
  document.getElementById("branch-replay-restart")?.addEventListener("click", () => { at = -1; start(); });
  document.getElementById("branch-replay-end")?.addEventListener("click", () => { at = events.length - 1; pause(); });
  speeds.forEach(button => button.addEventListener("click", () => { speed = Number(button.dataset.replaySpeed); if (playing) start(); else render(); }));
  document.querySelectorAll<HTMLButtonElement>("#branch-replay-controls button").forEach(button => { button.disabled = !events.length; });
  timeline.disabled = !events.length;
  window.addEventListener("pagehide", pause, { once: true });
  render();
}
