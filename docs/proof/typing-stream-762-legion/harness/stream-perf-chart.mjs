// Scratch (not committed): frame-interval chart from the recorded trace, rendered to PNG headless.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
const [file, out] = process.argv.slice(2);
const ev = JSON.parse(readFileSync(file, "utf8")).traceEvents;
const m = ev.find((e) => e.name === "stream-start"); const s = m.ts, e = ev.find((x) => x.name === "stream-end").ts;
const af = ev.filter((x) => x.name === "AnimationFrame" && x.ph === "b" && x.pid === m.pid && x.ts >= s && x.ts <= e).sort((a, b) => a.ts - b.ts);
const draws = ev.filter((x) => x.name === "Display::DrawAndSwap" && x.ts >= s && x.ts <= e).map((x) => x.ts).sort((a, b) => a - b);
const tasks = ev.filter((x) => x.ph === "X" && x.pid === m.pid && x.tid === m.tid && x.name === "RunTask" && x.ts >= s && x.ts <= e);
const W = 1500, H = 230, max = 40, dur = (e - s) / 1000;
const x = (ts) => ((ts - s) / 1000 / dur) * W, y = (ms) => H - (Math.min(ms, max) / max) * H;
const series = (pts, color) => { let d = ""; for (let i = 1; i < pts.length; i++) d += (i === 1 ? "M" : "L") + x(pts[i]).toFixed(1) + "," + y((pts[i] - pts[i - 1]) / 1000).toFixed(1); return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1"/>`; };
const bars = tasks.map((t) => `<rect x="${x(t.ts).toFixed(1)}" y="${y(t.dur / 1000).toFixed(1)}" width="1.2" height="${(H - y(t.dur / 1000)).toFixed(1)}" fill="#c47b2a"/>`).join("");
const line = (ms, label, color) => `<line x1="0" x2="${W}" y1="${y(ms)}" y2="${y(ms)}" stroke="${color}" stroke-dasharray="4 4"/><text x="${W - 4}" y="${y(ms) - 4}" text-anchor="end" fill="${color}" font-size="12">${label}</text>`;
const panel = (title, body) => `<h3>${title}</h3><svg width="${W}" height="${H}" style="background:#fff;border:1px solid #ddd">${body}${line(16.7, "16.7 ms (60 fps budget)", "#c00")}${line(6.06, "6.06 ms (165 Hz vsync)", "#888")}${line(50, "", "#c00")}</svg>`;
const html = `<!doctype html><body style="font:13px system-ui;margin:16px;background:#f7f7f7"><h2>PR #1290 @ 3394f5f: recorded pass, Chrome trace (${dur.toFixed(0)} ms streaming window, 12,442-char fixture, dev build, Legion GPU)</h2>
${panel("Presented frames: interval between viz Display::DrawAndSwap (ms, capped at 40)", series(draws, "#2a6"))}
${panel("Main-thread frames: interval between AnimationFrame begins (ms)", series(af.map((a) => a.ts), "#36c"))}
${panel("Renderer main-thread task durations (RunTask, ms); long-task threshold is 50 ms (off the chart top)", bars)}
<p>X axis: time from stream-start mark to stream-end mark.</p></body>`;
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
try { const p = await browser.newPage({ viewport: { width: 1540, height: 960 } }); await p.setContent(html); await p.screenshot({ path: join(out, "trace-frame-chart.png"), fullPage: true }); } finally { await browser.close(); }
console.log("chart", af.length, draws.length, tasks.length);
