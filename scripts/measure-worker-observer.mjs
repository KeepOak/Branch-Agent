// Imported only into the measured application, not its storage children.
import path from 'node:path';

if (process.argv[1] && path.basename(process.argv[1]) === 'worker.mjs' && process.send) {
  process.channel?.unref();
  const sample = () => process.send?.({
    type: 'worker-memory',
    rssBytes: process.memoryUsage.rss(),
    peakBytes: process.resourceUsage().maxRSS * 1024,
  });
  const timer = setInterval(sample, 25);
  timer.unref();
  sample();
  process.once('beforeExit', sample);
}
