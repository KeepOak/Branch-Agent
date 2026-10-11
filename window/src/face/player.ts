// Plays one pebble face on its canvas (DESIGN-SPEC §6.2, §6.6, §6.7). At rest it is the still. An action
// (think, work, search, read, talk) loops while it runs and finishes its pass before settling; an arrival
// (yay, oops, wait) and a reaction (hover, pat, wake) play one pass. Nothing plays off screen, while the window
// is hidden, under reduced motion or "Keep things still", or without a slot in the shared cap.
import { ACTION_STATES, ARRIVAL_STATES, type AgentState } from "./agentState";
import { faceCap } from "./cap";
import { SHEETS, inkColour, loadLayers, paintFrame, paintableColour, type Layers, type SheetState } from "./painter";

let nextId = 1;

export function motionAllowed(): boolean {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return !reduced && !document.documentElement.hasAttribute("data-still");
}

type Play = { sheet: SheetState; once: boolean; started: number; stopping: boolean; layers: Layers | null };

export class FacePlayer {
  readonly id = nextId++;
  private still: Layers | null = null;
  private play: Play | null = null;
  private frame = -1;
  private raf = 0;
  private current: AgentState | null = null;
  private visible = true;
  priority = 0;
  /** Called when playing starts or stops, for the data-face-playing hook. */
  onPlaying: (playing: boolean) => void = () => undefined;
  onError: (error: Error) => void = () => undefined;

  private readonly canvas: HTMLCanvasElement;
  private readonly look: { colour?: string; shape?: number; eyes?: string };

  constructor(canvas: HTMLCanvasElement, look: { colour?: string; shape?: number; eyes?: string } = {}) {
    this.canvas = canvas;
    this.look = look;
  }

  /** Draws the still once it has loaded. */
  async showStill(): Promise<void> {
    this.still ??= await loadLayers("still", this.look.shape, this.look.eyes);
    if (!this.play) {
      this.paint(this.still, -1);
    }
  }

  /** The face's state changed: start, keep or wind down the matching animation. */
  setState(state: AgentState): void {
    if (state === this.current) {
      return; // same state, same element: playback carries on, an arrival never replays (§6.6)
    }
    this.current = state;
    const sheet = state as SheetState;
    const action = ACTION_STATES.includes(state);
    const arrival = ARRIVAL_STATES.includes(state);
    if (this.play && this.play.sheet === sheet && !this.play.stopping) {
      return;
    }
    if (!action && !arrival) {
      this.windDown();
      return;
    }
    this.start(sheet, arrival);
  }

  /** A reaction (hover, pat): one pass, unless an action is already playing. */
  react(sheet: "hover" | "pat" | "wake"): void {
    if (!this.play) {
      this.start(sheet, true);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  /** Paints the current frame again (the theme's colour changed). */
  repaint(): void {
    const layers = this.play?.layers ?? this.still;
    if (layers) {
      this.paint(layers, this.play ? this.frame : -1);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    faceCap.release(this.id);
    this.play = null;
  }

  private start(sheet: SheetState, once: boolean): void {
    if (!motionAllowed() || !faceCap.request(this.id, "pebble", this.priority, () => this.toStill())) {
      this.toStill();
      return;
    }
    const play: Play = { sheet, once, started: performance.now(), stopping: false, layers: null };
    this.play = play;
    this.onPlaying(true);
    loadLayers(sheet, this.look.shape, this.look.eyes)
      .then((layers) => {
        play.layers = layers;
        play.started = performance.now();
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame((t) => this.tick(t));
      })
      .catch((error: Error) => {
        this.onError(error);
        this.toStill();
      });
  }

  private windDown(): void {
    if (this.play) {
      this.play.stopping = true;
    }
  }

  private tick(now: number): void {
    const play = this.play;
    if (!play?.layers) {
      return;
    }
    const { frames, fps } = SHEETS[play.sheet];
    const elapsed = Math.floor(((now - play.started) * fps) / 1000);
    const passDone = elapsed >= frames;
    if (passDone && (play.once || play.stopping)) {
      this.toStill();
      return;
    }
    if (this.visible && !document.hidden) {
      this.frame = elapsed % frames;
      this.paint(play.layers, this.frame);
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private toStill(): void {
    cancelAnimationFrame(this.raf);
    faceCap.release(this.id);
    const was = this.play !== null;
    this.play = null;
    this.frame = -1;
    if (this.still) {
      this.paint(this.still, -1);
    }
    if (was) {
      this.onPlaying(false);
    }
  }

  private paint(layers: Layers, frame: number): void {
    paintFrame(this.canvas, layers, frame, this.look.colour ? paintableColour(this.canvas, this.look.colour) : inkColour(this.canvas));
  }
}
