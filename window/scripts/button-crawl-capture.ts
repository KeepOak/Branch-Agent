// The crawl's stand-in for the microphone and the camera. The audio context is built when the harness loads, not on
// the first capture: building it inside a click takes a few hundred milliseconds on a loaded machine, and the crawl
// reads any control over 300 ms as slow. A capture that was not warmed up still works, it just pays that cost.

export type CrawlCapture = {
  /** Builds the shared audio context now, outside any click. Calling it again is free. */
  prewarm(): void;
  /** Resolves to a silent stream of the kind the constraints ask for. */
  capture(constraints: MediaStreamConstraints): Promise<MediaStream>;
};

export function createCrawlCapture(newAudioContext: () => AudioContext, newCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): CrawlCapture {
  let audio: AudioContext | null = null;
  return {
    prewarm() {
      audio ??= newAudioContext();
    },
    capture(constraints) {
      if (constraints.video) return Promise.resolve(newCanvas().captureStream());
      audio ??= newAudioContext();
      return Promise.resolve(audio.createMediaStreamDestination().stream);
    },
  };
}
