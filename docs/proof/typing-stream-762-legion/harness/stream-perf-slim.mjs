import { readFileSync, writeFileSync } from "node:fs";
const raw = JSON.parse(readFileSync(process.argv[2], "utf8")); const ev = raw.traceEvents;
const m = ev.find((e) => e.name === "stream-start"); const from = m.ts + Number(process.argv[4] || 3000) * 1000, to = from + Number(process.argv[5] || 1500) * 1000;
const okCat = (c = "") => !/cpu_profiler|v8\.execute|latencyInfo|loading|^gpu$|^viz$/.test(c);
const keep = ev.filter((x) => x.ph === "M" || (x.ts >= from && x.ts <= to && x.name !== "Screenshot" && okCat(x.cat) && (x.pid === m.pid || /Display|Draw|Swap|BeginFrame/.test(x.name))));
const out = JSON.stringify({ traceEvents: keep });
if (/Users[\\/]|AppData/.test(out)) throw new Error("local path in trace slice");
writeFileSync(process.argv[3], out);
console.log(ev.length, "->", keep.length);
