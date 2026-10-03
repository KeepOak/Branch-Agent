import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectPptImageDimensions } from './ppt-geometry-qa-image.ts';

it('reads PNG geometry from a byte view with a nonzero offset', () => {
  const bytes = Buffer.alloc(30);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 6);
  bytes.writeUInt32BE(640, 22);
  bytes.writeUInt32BE(480, 26);
  assert.deepEqual(detectPptImageDimensions(bytes.subarray(6)), { width:640, height:480 });
});
it('reads SVG viewBox and rejects source XML declarations with entities', () => {
  assert.deepEqual(detectPptImageDimensions(Buffer.from('<svg viewBox="0 0 960 540"></svg>'), 'slide.svg'), { width:960, height:540 });
  assert.equal(detectPptImageDimensions(Buffer.from('<!DOCTYPE svg><svg width="960" height="540"/>'), 'slide.svg'), undefined);
});
it('leaves unsupported or truncated media unchecked', () => {
  assert.equal(detectPptImageDimensions(Buffer.alloc(3)), undefined);
  assert.equal(detectPptImageDimensions(Buffer.from('GIF89a')), undefined);
});
