// Source: Hermes18d125cc1bd9d0e26188ab49bb325427d5945fa2 agent/image_eviction_policy.py.
export const OUTBOUND_IMAGE_LIMIT = 20;
export const OUTBOUND_IMAGE_BUDGET_BYTES = 24000000;
export const IMAGE_EVICTION_BATCH = 8;
export const OUTBOUND_IMAGE_FLOOR = 3;
/** Retire OLDEST carriers in stable batches, preserving cached prefixes between advances.
 * Reserved user uploads are never rewritten; the floor only shelters an unfixable block
 * ceiling, never byte pressure. Arrays describe newest carriers first. */
export function outboundImageRetireCount(blocks: readonly number[], reservedBlocks: number, options: {
  carrierBytesNewestFirst?: readonly number[];
  reservedBytes?: number;
  limit?: number;
  budget?: number;
  batch?: number;
  floor?: number;
} = {}): number {
  const { carrierBytesNewestFirst: sizes, reservedBytes = 0, limit = OUTBOUND_IMAGE_LIMIT,
    budget = OUTBOUND_IMAGE_BUDGET_BYTES, batch = IMAGE_EVICTION_BATCH } = options;
  const total = blocks.length;
  const blocksKept = [0]; const bytesKept = [0];
  for (let index = 0; index < total; index++) {
    blocksKept.push(blocksKept[index]! + blocks[index]!);
    bytesKept.push(bytesKept[index]! + (sizes ? sizes[index]! : 0));
  }
  const bytesFit = (kept: number) => sizes === undefined || reservedBytes + bytesKept[kept]! <= budget;
  const fits = (kept: number) => reservedBlocks + blocksKept[kept]! <= limit && bytesFit(kept);
  if (fits(total)) { return 0; }
  const floor = Math.min(Math.max(options.floor ?? OUTBOUND_IMAGE_FLOOR, 0), total);
  const maxRetire = !fits(0) && bytesFit(floor) ? total - floor : total;
  if (maxRetire <= 0) { return 0; }
  let window = 0;
  if (fits(0)) { for (let kept = 0; kept <= total; kept++) { if (fits(kept)) { window = kept; } } }
  const quantum = Math.max(1, Math.min(batch, window - floor));
  let retire = 0;
  while (retire < maxRetire) {
    retire = Math.min(retire + quantum, maxRetire);
    if (fits(total - retire)) { break; }
  }
  return retire;
}
