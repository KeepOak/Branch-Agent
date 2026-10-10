// Paints the classic pebble (DESIGN-SPEC §6.3): three layers per frame, drawn on one canvas in the order of
// old Branch's pebble renderer: fill the colour, multiply the body, cut to the body's outline, then add the
// light and the fx (eyes, mouth, contact shadow). Stills are `still-*`; state sheets are 12-column sprite sheets.

/** The layout of public/pebble/pebble.json (copied from DESIGN-SPEC's assets/pebble). */
export const SHEET = { size: 144, lightSize: 72, cols: 12, share: 0.7, bottom: 0.08 } as const;

export type SheetState = "idle" | "think" | "search" | "read" | "work" | "wait" | "talk" | "yay" | "oops" | "sleep" | "hover" | "pat" | "wake";

/** Frames and frames per second of each state sheet (pebble.json). */
export const SHEETS: Record<SheetState, { frames: number; fps: number }> = {
  idle: { frames: 48, fps: 12 },
  think: { frames: 48, fps: 24 },
  search: { frames: 60, fps: 24 },
  read: { frames: 72, fps: 24 },
  work: { frames: 24, fps: 24 },
  wait: { frames: 48, fps: 24 },
  talk: { frames: 36, fps: 24 },
  yay: { frames: 48, fps: 24 },
  oops: { frames: 48, fps: 24 },
  sleep: { frames: 36, fps: 12 },
  hover: { frames: 15, fps: 24 },
  pat: { frames: 20, fps: 24 },
  wake: { frames: 24, fps: 24 },
};

export type Layers = { body: HTMLImageElement; light: HTMLImageElement; fx: HTMLImageElement };

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  let found = images.get(src);
  if (!found) {
    found = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(src);
        reject(new Error(`could not load ${src}`));
      };
      img.src = src;
    });
    images.set(src, found);
  }
  return found;
}

/** Sapling's look: shape 0 (Circle) and round eyes (DESIGN-SPEC §1.2 rule 14, §6.3). */
export async function loadLayers(state: SheetState | "still", shape = 0, eyes = "round"): Promise<Layers> {
  const [body, light, fx] = await Promise.all([
    loadImage(`/pebble/${state}-body-${shape}.webp`),
    loadImage(`/pebble/${state}-light-${shape}.webp`),
    loadImage(`/pebble/${state}-fx-${eyes}.webp`),
  ]);
  return { body, light, fx };
}

/** The theme's --ink-2, the classic pebble's colour (DECISIONS.md item 22). */
export function inkColour(el: Element): string {
  return getComputedStyle(el).getPropertyValue("--ink-2").trim();
}

/** A colour a canvas can paint: a theme token such as `var(--trunk-3)` becomes the value it holds on `el`. */
export function paintableColour(el: Element, colour: string): string {
  const token = /^var\((--[\w-]+)\)$/.exec(colour.trim());
  return token ? getComputedStyle(el).getPropertyValue(token[1]).trim() || inkColour(el) : colour;
}

/** Draws one frame (`frame` -1 means the still images, which hold one frame each). */
export function paintFrame(canvas: HTMLCanvasElement, layers: Layers, frame: number, colour: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const { width, height } = canvas;
  const cell = (img: HTMLImageElement, size: number): [number, number, number, number] =>
    frame < 0
      ? [0, 0, img.naturalWidth, img.naturalHeight]
      : [(frame % SHEET.cols) * size, Math.floor(frame / SHEET.cols) * size, size, size];
  const draw = (img: HTMLImageElement, size: number) => ctx.drawImage(img, ...cell(img, size), 0, 0, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "multiply";
  draw(layers.body, SHEET.size);
  ctx.globalCompositeOperation = "destination-in";
  draw(layers.body, SHEET.size);
  ctx.globalCompositeOperation = "source-over";
  draw(layers.light, SHEET.lightSize);
  draw(layers.fx, SHEET.size);
}
