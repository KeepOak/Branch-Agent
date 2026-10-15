import { describe, expect, it, vi } from 'vitest';
import { createCrawlCapture } from './button-crawl-capture';

// Fails on main: the harness built its audio context inside the first capture, so a voice-note click paid for it.
describe('button crawl capture', () => {
  it('builds the audio context when prewarmed, not inside the first capture', async () => {
    const context = { createMediaStreamDestination: vi.fn(() => ({ stream: { id: 'silent' } })) };
    const newAudioContext = vi.fn(() => context as unknown as AudioContext);
    const capture = createCrawlCapture(newAudioContext);
    expect(newAudioContext).not.toHaveBeenCalled();
    capture.prewarm();
    expect(newAudioContext).toHaveBeenCalledTimes(1);
    const stream = await capture.capture({ audio: true });
    expect(stream).toEqual({ id: 'silent' });
    expect(newAudioContext).toHaveBeenCalledTimes(1);
  });

  it('still answers an audio request that was not prewarmed', async () => {
    const context = { createMediaStreamDestination: vi.fn(() => ({ stream: { id: 'late' } })) };
    const capture = createCrawlCapture(() => context as unknown as AudioContext);
    await expect(capture.capture({ audio: true })).resolves.toEqual({ id: 'late' });
  });
});
