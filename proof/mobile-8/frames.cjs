// Scales every screencast frame to 393x852, joins them at their real timing into a webm, makes a contact
// sheet at 3 frames a second, and counts blank frames (ffmpeg signalstats: luma range under 10).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const dir = path.join(out, 'frames');
const scaled = path.join(out, 'scaled');
fs.mkdirSync(scaled, { recursive: true });
const names = fs.readdirSync(dir).filter((n) => n.endsWith('.jpg')).sort();
let blank = 0;
for (const n of names) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, n), '-vf', 'scale=393:852', path.join(scaled, n)], { windowsHide: true });
  const stats = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(scaled, n), '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], { windowsHide: true }).toString();
  const min = Number(/YMIN=(\d+)/.exec(stats)?.[1]);
  const max = Number(/YMAX=(\d+)/.exec(stats)?.[1]);
  if (!(max - min >= 10)) { blank++; console.log('blank', n, min, max); }
}
fs.copyFileSync(path.join(dir, 'list.txt'), path.join(scaled, 'list.txt'));
const webm = path.join(out, 'approvals-entry-clickthrough.webm');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vf', 'fps=10,format=yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '600k', webm], { cwd: scaled, windowsHide: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-vf', 'fps=3,scale=130:-2,tile=10x3', '-frames:v', '1', '-update', '1', path.join(out, 'clickthrough-sheet.jpg')], { windowsHide: true });
console.log('frames', names.length, 'blank', blank);