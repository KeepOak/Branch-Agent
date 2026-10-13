/** Playback can begin before a decoded frame is presented: keep the still until then. */
export function watchPetFrame(video: HTMLVideoElement, show: () => void): () => void {
  let alive = true;
  if (typeof video.requestVideoFrameCallback === "function") {
    const frame = video.requestVideoFrameCallback(() => { if (alive) show(); });
    return () => { alive = false; video.cancelVideoFrameCallback?.(frame); };
  }
  const decoded = () => { if (alive && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) show(); };
  video.addEventListener("loadeddata", decoded);
  video.addEventListener("playing", decoded);
  decoded();
  return () => { alive = false; video.removeEventListener("loadeddata", decoded); video.removeEventListener("playing", decoded); };
}
