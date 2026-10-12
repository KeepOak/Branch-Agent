// Scratch (not committed): side-by-side and crops for the proof.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
const base = process.argv[2];
const img = (p, type = "png") => `data:image/${type};base64,${readFileSync(join(base, p)).toString("base64")}`;
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 380 } });
  await page.setContent(`<body style="margin:0;overflow:hidden"><img src="${img("dev/chrome-gpu.png")}" style="display:block"></body>`);
  await page.screenshot({ path: join(base, "dev/gpu-feature-status.png"), clip: { x: 0, y: 0, width: 1200, height: 360 } });
  const cmp = await browser.newPage({ viewport: { width: 1640, height: 900 } });
  const cell = (src, cap, crop) => `<figure style="margin:0;width:800px"><figcaption style="font:600 14px system-ui;margin:6px 0">${cap}</figcaption><div style="width:800px;height:${crop.h}px;overflow:hidden;border:1px solid #ccc;background:#fff"><img src="${src}" style="margin-left:-${crop.x}px;margin-top:-${crop.y}px"></div></figure>`;
  await cmp.setContent(`<body style="margin:12px;background:#f3f3f3;font:13px system-ui"><h3 style="margin:0 0 8px">Before text: approved preview (left) vs PR #1290 @ 3394f5f (right)</h3><div style="display:flex;gap:16px">
  ${cell(img("preview/preview-1-typing.png"), "Preview: face + 'Scout is thinking' + three dots", { x: 370, y: 200, h: 120 })}
  ${cell(img("dev/typing-start.png"), "PR: face + 'Fixture Agent is typing' + three dots", { x: 0, y: 40, h: 120 })}</div>
  <h3 style="margin:16px 0 8px">During streaming</h3><div style="display:flex;gap:16px">
  ${cell(img("preview/preview-4-settled.png"), "Preview: thinking row is replaced by the reply; newest words fade in from blur(2px), 320 ms per word, 28 ms stagger", { x: 370, y: 255, h: 80 })}
  ${cell(img("dev/early-stream.png"), "PR: newest chunk fades from 25% opacity over 180 ms; 'is working' row stays below", { x: 0, y: 560, h: 240 })}</div></body>`);
  await cmp.screenshot({ path: join(base, "dev/compare-preview-vs-pr-" + Date.now() + ".png"), fullPage: true });
} finally { await browser.close(); }
console.log("ok");
