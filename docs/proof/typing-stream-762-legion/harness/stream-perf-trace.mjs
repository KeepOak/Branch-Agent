// Scratch (not committed): summarize a Chrome trace for the streaming window.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const [file, outDir] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, "utf8"));
const ev = raw.traceEvents ?? raw;
const mark = (n) => ev.find((e) => e.name === n && (e.cat || "").includes("blink.user_timing"));
const s = mark("stream-start")?.ts, e = mark("stream-end")?.ts;
const inWin = (x) => x.ts >= s && x.ts <= e;
// renderer main thread = thread that emitted the user timing mark
const main = mark("stream-start"); const pid = main?.pid, tid = main?.tid;
const tasks = ev.filter((x) => x.ph === "X" && x.pid === pid && x.tid === tid && (x.name === "RunTask" || x.name === "ThreadControllerImpl::RunTask") && inWin(x));
const long = tasks.filter((x) => x.dur > 50000).map((x) => ({ startMs: +((x.ts - s) / 1000).toFixed(1), durMs: +(x.dur / 1000).toFixed(1) }));
const maxTask = Math.max(0, ...tasks.map((x) => x.dur)) / 1000;
const sortedTasks = tasks.map((x) => x.dur / 1000).sort((a, b) => a - b);
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)] : null;
// compositor frames: PipelineReporter top-level async events carry the frame state
const pr = ev.filter((x) => x.name === "PipelineReporter" && x.ph === "b" && x.pid === pid && inWin(x));
const af = ev.filter((x) => x.name === "AnimationFrame" && x.ph === "b" && x.pid === pid && inWin(x)).sort((a, b) => a.ts - b.ts);
const afi = []; for (let i = 1; i < af.length; i++) afi.push((af[i].ts - af[i - 1].ts) / 1000);
const afs = [...afi].sort((a, b) => a - b);
const afWork = af.map((x) => x.args?.animation_frame_timing_info?.duration_ms ?? 0).sort((a, b) => a - b);
const afBlock = af.map((x) => x.args?.animation_frame_timing_info?.blocking_duration_ms ?? 0);
const states = {}; for (const x of pr) { const st = x.args?.frame_reporter?.state ?? x.args?.chrome_frame_reporter?.state ?? "unknown"; states[st] = (states[st] || 0) + 1; }
// presented frame intervals from viz Display::DrawAndSwap or DrawFrame
const draws = ev.filter((x) => x.name === "Display::DrawAndSwap" && inWin(x)).map((x) => x.ts).sort((a, b) => a - b);
const di = []; for (let i = 1; i < draws.length; i++) di.push((draws[i] - draws[i - 1]) / 1000);
const ds = [...di].sort((a, b) => a - b);
const shots = ev.filter((x) => x.name === "Screenshot" && x.args?.snapshot && inWin(x));
mkdirSync(outDir, { recursive: true });
const pick = [0.1, 0.35, 0.6, 0.9].map((f) => shots[Math.floor(f * (shots.length - 1))]).filter(Boolean);
pick.forEach((x, i) => writeFileSync(join(outDir, `trace-shot-${i + 1}-${Math.round((x.ts - s) / 1000)}ms.jpg`), Buffer.from(x.args.snapshot, "base64")));
const summary = {
  windowMs: +((e - s) / 1000).toFixed(0), mainThreadTasks: tasks.length,
  taskMs: { median: +pct(sortedTasks, 0.5)?.toFixed(2), p95: +pct(sortedTasks, 0.95)?.toFixed(2), p99: +pct(sortedTasks, 0.99)?.toFixed(2), max: +maxTask.toFixed(2) },
  longTasksOver50: long,
  frameReporterStates: states,
  animationFrames: { count: af.length, intervalMs: { median: +pct(afs, 0.5)?.toFixed(2), p95: +pct(afs, 0.95)?.toFixed(2), p99: +pct(afs, 0.99)?.toFixed(2), max: afs.length ? +afs[afs.length - 1].toFixed(2) : null }, workMs: { median: pct(afWork, 0.5), p95: pct(afWork, 0.95), p99: pct(afWork, 0.99), max: afWork.at(-1) }, blockingFramesOver0: afBlock.filter((b) => b > 0).length },
  drawIntervals: { name: draws.length ? "viz draw" : "none", count: ds.length, median: +pct(ds, 0.5)?.toFixed(2), p95: +pct(ds, 0.95)?.toFixed(2), p99: +pct(ds, 0.99)?.toFixed(2), max: ds.length ? +ds[ds.length - 1].toFixed(2) : null },
  screenshotsInWindow: shots.length,
};
writeFileSync(join(outDir, "trace-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
