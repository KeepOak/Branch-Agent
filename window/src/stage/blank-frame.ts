// A frame whose sampled pixels are all black is what macOS hands back for a screen it won't let Branch capture.
// The pane checks each frame at a thumbnail's size; where the window can't decode images (tests), nothing is blank.

/** True when every sampled RGBA pixel is black (each channel at most 2), ignoring alpha. */
export function allBlack(data: ArrayLike<number>): boolean {
  if (data.length < 4) return false;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i]! > 2 || data[i + 1]! > 2 || data[i + 2]! > 2) return false;
  }
  return true;
}

/** Decodes the frame at 48×27 and checks it. Returns false when it can't tell. */
export async function frameIsBlank(format: "png" | "jpeg", base64: string): Promise<boolean> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return false;
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${format}` }), { resizeWidth: 48, resizeHeight: 27 });
    const canvas = new OffscreenCanvas(48, 27);
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return allBlack(context.getImageData(0, 0, 48, 27).data);
  } catch {
    return false;
  }
}
