// Branch's rename pass (DECISIONS.md item 127): OpenClaw's names become Branch's, and OpenClaw's feature
// names become Branch's words. The map is scripts/rebrand-map.json; docs/foundation/REBRAND.md explains it.
// Run from the Branch repo root (or a worktree of it):
//   node scripts/rebrand.mjs plan  [paths...]   what would change, plus name and path clashes (changes nothing)
//   node scripts/rebrand.mjs apply [paths...]   rewrite file contents, then rename files and folders (git mv)
//   node scripts/rebrand.mjs left  [paths...]   list every old name still left, with the reason it is kept
//   node scripts/rebrand.mjs redo <upstream path>...   rewrite engine files from the pin with the current map
//   node scripts/rebrand.mjs check --all            every copied file at once (prints only the ones that differ)
//   node scripts/rebrand.mjs check <upstream path>...
//       page 40's "unchanged at the pin" check after the rename: renames the pinned upstream file in memory
//       and compares it with the engine's file at the renamed path. Prints "unchanged <path>" or "CHANGED <path>".
// [paths...] are tracked files or folders; with none, engine/ and window/. Files copied in later are renamed
// by running "apply" on them. Exits 1 on a clash ("plan") or a changed file ("check").
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAP = JSON.parse(readFileSync(new URL("./rebrand-map.json", import.meta.url), "utf8"));
const PIN = "c83f02659ff9e181f81d12959970261fcaaa1d07";
const CLONE = "C:/Users/bishi/Code/atlas-src/openclaw__openclaw";
const WORDS = MAP.words.map(([from, to]) => ({ from, to, re: new RegExp(from, "gi") }));
const PROTECT = MAP.protect.map((p) => ({ re: new RegExp(p.re, "g" + (p.flags ?? "").replace("g", "")), in: p.in ? new RegExp(p.in) : null }));
const SKIP = MAP.skip.map((s) => new RegExp(s.re));
const FIXUPS = MAP.fixups.map((f) => ({ re: new RegExp(f.re, "g"), to: f.to }));
const ANY_WORD = new RegExp([...MAP.words.map(([from]) => from), ...(MAP.phrases ?? []).map((p) => p.key)].join("|"), "i");
const KEEP = MAP.keep ? new RegExp(MAP.keep.re, MAP.keep.flags ?? "") : null;

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30, ...opts });

/** The target word in the case of the matched text: OPENCLAW → BRANCH, OpenClaw → Branch, openClaw → branch. */
export function inCaseOf(matched, to) {
  if (matched === matched.toUpperCase()) return to.toUpperCase();
  if (matched[0] === matched[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
  return to;
}

/** Start and end of every protected span in the text (rules with "in" apply only to files it matches). */
function protectedSpans(text, file) {
  const spans = [];
  for (const { re, in: inFiles } of PROTECT) {
    if (inFiles && !(file && inFiles.test(file))) continue;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) if (m[0].length) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

const insideAny = (spans, start, end) => spans.some(([a, b]) => start < b && end > a);

/** The rules in the order they run: the product-name phrases first, then the words (in the matched text's case). */
const RULES = [
  ...(MAP.phrases ?? []).map((p) => ({ re: new RegExp(p.re, "g"), to: () => p.to, notIn: p.notIn ? new RegExp(p.notIn) : null })),
  ...WORDS.map((w) => ({ re: w.re, to: (m) => inCaseOf(m, w.to) })),
];

/** Renames the words in one text, leaving protected spans alone. Returns the text and how many names changed.
 *  `file` is the text's renamed repo path, for phrase rules that skip some files; null (paths and names) skips phrases. */
export function renameText(text, file = "") {
  if (!ANY_WORD.test(text)) return { text, count: 0 };
  let count = 0;
  let out = text;
  for (const rule of RULES) {
    if (rule.notIn && (file === null || rule.notIn.test(file))) continue;
    const spans = protectedSpans(out, file);
    out = out.replace(rule.re, (m, ...rest) => {
      const offset = typeof rest.at(-1) === "object" ? rest.at(-3) : rest.at(-2);
      if (insideAny(spans, offset, offset + m.length)) return m;
      count++;
      return rule.to(m);
    });
  }
  if (count) for (const f of FIXUPS) out = out.replace(f.re, f.to);
  return { text: out, count };
}

/** Renames the words in a repo path, keeping protected names (such as OpenClawKit) as they are. */
export function renamePath(p) {
  return renameText(p, null).text;
}

const isSkipped = (p) => SKIP.some((re) => re.test(p));
const isBinaryName = (p) => MAP.binaryExtensions.includes(path.extname(p).toLowerCase());
const isBinaryData = (buf) => buf.subarray(0, 8000).includes(0);

function trackedFiles(roots) {
  const args = ["ls-files", "-z", "--", ...(roots.length ? roots : ["engine", "window"])];
  return git(args).split("\0").filter(Boolean);
}

/** Reads a tracked text file, or returns null for a skipped, binary or missing file. */
function readText(p) {
  if (isSkipped(p) || isBinaryName(p) || !existsSync(p)) return null;
  const buf = readFileSync(p);
  return isBinaryData(buf) ? null : buf.toString("utf8");
}

/** Every file whose contents change and every path that moves, without writing anything. */
function survey(files) {
  const edits = [];
  const moves = [];
  for (const p of files) {
    const text = readText(p);
    if (text !== null) {
      const r = renameText(text, renamePath(p));
      if (r.count) edits.push({ path: p, count: r.count, text: r.text });
    }
    if (!isSkipped(p)) {
      const to = renamePath(p);
      if (to !== p) moves.push({ from: p, to });
    }
  }
  return { edits, moves };
}

/** Paths that would land on a file that already exists, or on each other (Windows ignores case). */
function pathClashes(files, moves) {
  const staying = new Set(files.map((f) => f.toLowerCase()));
  for (const m of moves) staying.delete(m.from.toLowerCase());
  const seen = new Map();
  const clashes = [];
  for (const m of moves) {
    const key = m.to.toLowerCase();
    if (staying.has(key)) clashes.push(`${m.from} -> ${m.to}: a file is already there`);
    if (seen.has(key)) clashes.push(`${m.from} and ${seen.get(key)} -> ${m.to}`);
    seen.set(key, m.from);
  }
  return clashes;
}

const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Names that the rename would turn into a name the same file already uses for something else. */
function nameClashes(files) {
  const clashes = [];
  for (const p of files) {
    const text = readText(p);
    if (text === null || !ANY_WORD.test(text)) continue;
    const tokens = new Set(text.match(TOKEN) ?? []);
    for (const t of tokens) {
      if (!ANY_WORD.test(t)) continue;
      const to = renameText(t, null).text;
      if (to !== t && tokens.has(to) && /^[A-Za-z]/.test(t)) clashes.push(`${p}: ${t} -> ${to} (already used)`);
    }
  }
  return clashes;
}

function plan(roots) {
  const files = trackedFiles(roots);
  const { edits, moves } = survey(files);
  const words = edits.reduce((n, e) => n + e.count, 0);
  console.log(`files: ${files.length}; files to rewrite: ${edits.length} (${words} words); paths to move: ${moves.length}`);
  const clashes = pathClashes(files, moves);
  for (const c of clashes) console.log(`PATH CLASH ${c}`);
  for (const c of nameClashes(files)) console.log(`NAME ${c}`);
  return clashes.length ? 1 : 0;
}

/** Moves one path with git, folder by folder, so case-only renames also work on Windows. */
function gitMove(from, to) {
  const dir = path.posix.dirname(to);
  if (dir !== ".") execFileSync("node", ["-e", `require("fs").mkdirSync(${JSON.stringify(dir)},{recursive:true})`]);
  if (from.toLowerCase() === to.toLowerCase()) {
    git(["mv", "--", from, `${to}.rebrand-tmp`]);
    git(["mv", "--", `${to}.rebrand-tmp`, to]);
  } else {
    git(["mv", "--", from, to]);
  }
}

function apply(roots) {
  const files = trackedFiles(roots);
  const { edits, moves } = survey(files);
  const clashes = pathClashes(files, moves);
  if (clashes.length) { for (const c of clashes) console.log(`PATH CLASH ${c}`); return 1; }
  for (const e of edits) writeFileSync(e.path, e.text);
  for (const m of moves) gitMove(m.from, m.to);
  console.log(`rewrote ${edits.length} files; moved ${moves.length} paths`);
  return 0;
}

/** Which protect or skip rule keeps an old name, for the "left" report. */
function keptBecause(p, line) {
  const skip = MAP.skip.find((s) => new RegExp(s.re).test(p));
  if (skip) return `skipped file: ${skip.why}`;
  if (isBinaryName(p)) return "binary file";
  if (KEEP && KEEP.test(line) && !new RegExp(MAP.words.map(([from]) => from).join("|"), "i").test(line.replace(new RegExp(MAP.keep.re, "g" + (MAP.keep.flags ?? "")), ""))) {
    return "kept on purpose: an outside service's or tool's id, or a legacy name (map: keep)";
  }
  const rule = MAP.protect.find((r) => new RegExp(r.re, (r.flags ?? "").replace("g", "")).test(line) && ANY_WORD.test(line));
  return rule ? `protected: ${rule.why}` : "NOT PROTECTED: the rename missed it";
}

function left(roots) {
  let missed = 0;
  for (const p of trackedFiles(roots)) {
    if (!isSkipped(p) && renamePath(p) !== p) { console.log(`${p}: path still has an old name`); missed++; }
    const buf = existsSync(p) ? readFileSync(p) : null;
    if (!buf || isBinaryData(buf)) continue;
    buf.toString("utf8").split("\n").forEach((line, i) => {
      if (!ANY_WORD.test(line)) return;
      const why = keptBecause(p, line);
      if (why.startsWith("NOT")) missed++;
      console.log(`${p}:${i + 1}: ${why}: ${line.trim().slice(0, 140)}`);
    });
  }
  console.log(missed ? `${missed} old name(s) the rename missed` : "every old name left is protected or in a skipped file");
  return missed ? 1 : 0;
}

/** Every file of the Step 2 copy, renamed in memory from the clone's checkout at the pin, against the engine. Text is
 *  compared with line endings made LF. Prints only the files that differ, then a count. */
function checkAll() {
  if (git(["-C", CLONE, "rev-parse", "HEAD"]).trim() !== PIN) throw new Error(`${CLONE} is not at ${PIN}`);
  const notCopied = /^(apps\/(?!shared\/OpenClawKit\/Sources\/OpenClawKit\/Resources\/tool-display\.json$)|\.agents\/|\.claude\/|AGENTS\.md$|CLAUDE\.md$)/;
  const lf = (b) => b.toString("latin1").replace(/\r\n/g, "\n");
  let differ = 0;
  let total = 0;
  for (const up of git(["-C", CLONE, "ls-files", "-z"]).split("\0").filter(Boolean)) {
    if (notCopied.test(up)) continue;
    total++;
    const pinned = readFileSync(`${CLONE}/${up}`);
    const local = isSkipped(`engine/${up}`) ? `engine/${up}` : renamePath(`engine/${up}`);
    const text = !isBinaryData(pinned) && !isSkipped(local) && !isBinaryName(up);
    const expected = text ? Buffer.from(renameText(pinned.toString("utf8"), local).text) : pinned;
    const same = existsSync(local) && (text ? lf(readFileSync(local)) === lf(expected) : readFileSync(local).equals(expected));
    if (!same) { differ++; console.log(`CHANGED ${up}${local !== `engine/${up}` ? ` (as ${local})` : ""}`); }
  }
  console.log(`${total - differ} of ${total} copied files are the pinned file renamed; ${differ} differ`);
  return differ ? 1 : 0;
}

/** Page 40's hash check after the rename: the pinned file, renamed in memory, against the engine's file. */
function check(upstreamPaths) {
  if (upstreamPaths[0] === "--all") return checkAll();
  let changed = 0;
  for (const up of upstreamPaths) {
    const pinned = execFileSync("git", ["-C", CLONE, "show", `${PIN}:${up}`], { maxBuffer: 1 << 30 });
    const local = isSkipped(`engine/${up}`) ? `engine/${up}` : renamePath(`engine/${up}`);
    const expected = isBinaryData(pinned) || isSkipped(local) || isBinaryName(up) ? pinned : Buffer.from(renameText(pinned.toString("utf8"), local).text);
    const same = existsSync(local) && hashOf(readFileSync(local)) === hashOf(expected);
    if (!same) changed++;
    console.log(`${same ? "unchanged" : "CHANGED"} ${up}${local !== `engine/${up}` ? ` (as ${local})` : ""}`);
  }
  return changed ? 1 : 0;
}

/** git's blob id of some bytes, read through the repo's line-ending rules (as git hash-object does). */
function hashOf(buf) {
  return execFileSync("git", ["hash-object", "--stdin", "--path=engine/x.ts"], { input: buf, encoding: "utf8" }).trim();
}

/** Rewrites engine files from the pinned upstream, renamed with the current map (after a map change). Only for
 *  files the branch has not otherwise changed: check them first. */
function redo(upstreamPaths) {
  for (const up of upstreamPaths) {
    const pinned = execFileSync("git", ["-C", CLONE, "show", `${PIN}:${up}`], { maxBuffer: 1 << 30 });
    const local = renamePath(`engine/${up}`);
    writeFileSync(local, isBinaryData(pinned) ? pinned : renameText(pinned.toString("utf8"), local).text);
    console.log(`rewrote ${local} from ${up}`);
  }
  return 0;
}

const COMMANDS = { plan, apply, left, check, redo };
const [cmd, ...rest] = process.argv.slice(2);
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/rebrand.mjs")) {
  if (!COMMANDS[cmd]) { console.error("usage: node scripts/rebrand.mjs plan|apply|left|check|redo [paths...]"); process.exit(2); }
  process.exit(COMMANDS[cmd](rest));
}
