import { useEffect, useRef, useState } from "react";
import type { AgentState } from "./agentState";
import { SHEET } from "./painter";
import { FacePlayer } from "./player";
import "./face.css";
import { useTrunkAppearance } from "./appearance";
import { CharacterFace } from "./CharacterFace";
import { useLookPrefs, type LookPrefs } from "./look-prefs";

type Props = {
  /** The face size in CSS pixels (§5.10: 28 gutter, 32 header, 42 rows, 150 empty conversation). */
  size: number;
  label?: string;
  /** What the Trunk is doing (§6.2). Defaults to resting. */
  state?: AgentState;
  /** Cap priority (face/cap.ts PRIORITY): the open conversation's Trunk plays first. */
  priority?: number;
  /** Plays the pebble's hover and pat reactions (§6.2 "Reactions"). */
  reactive?: boolean;
};

/** At 24 px and smaller the face is the flat pebble: the colour in its shape with two white eyes (§6.3). */
function FlatPebble({ size, label, state }: { size: number; label?: string; state: AgentState }) {
  return (
    <span
      className={state === "sleep" ? "flat-pebble asleep" : "flat-pebble"}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      data-face-state={state}
    >
      <i />
      <i />
    </span>
  );
}

function useThemeRepaint(player: FacePlayer | null): void {
  useEffect(() => {
    if (!player) {
      return;
    }
    const repaint = () => player.repaint();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", repaint);
    const observer = new MutationObserver(repaint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => {
      scheme.removeEventListener("change", repaint);
      observer.disconnect();
    };
  }, [player]);
}

function useVisibility(player: FacePlayer | null, el: HTMLElement | null): void {
  useEffect(() => {
    if (!player || !el || typeof IntersectionObserver !== "function") {
      return;
    }
    const io = new IntersectionObserver((entries) => player.setVisible(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [player, el]);
}

/** One Trunk face: the classic pebble's still at rest, its state's sheet when something happens. */
export function Face(props: Props) {
  const appearance = useTrunkAppearance(props.label);
  const look = useLookPrefs();
  const shown = { ...props, state: shownState(props.state ?? "idle", look), reactive: Boolean(props.reactive) && look.reactsToTouch };
  return appearance ? <CharacterFace {...shown} appearance={appearance} /> : <ClassicFace {...shown} />;
}

/** The state a face plays under Appearance › Characters: "Acts out what it is doing" off keeps it still (asleep stays
 *  asleep), "Moves while it speaks" off keeps it still while it talks. */
export function shownState(state: AgentState, look: Pick<LookPrefs, "actsOut" | "movesWhileSpeaking">): AgentState {
  if (state === "talk" && !look.movesWhileSpeaking) return "idle";
  if (!look.actsOut && state !== "sleep" && state !== "talk") return "idle";
  return state;
}

function ClassicFace({ size, label, state = "idle", priority = 0, reactive = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const [player, setPlayer] = useState<FacePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!canvas.current) {
      return;
    }
    const p = new FacePlayer(canvas.current);
    p.onPlaying = setPlaying;
    p.onError = () => setBroken(true);
    p.showStill().catch(() => setBroken(true));
    setPlayer(p);
    return () => p.dispose();
  }, []);
  useEffect(() => {
    if (player) {
      player.priority = priority;
      player.setState(state);
    }
  }, [player, state, priority]);
  useThemeRepaint(player);
  useVisibility(player, box.current);
  if (size <= 24) {
    return <FlatPebble size={size} label={label} state={state} />;
  }
  const frame = Math.round(size / SHEET.share);
  const ratio = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  return (
    <span
      ref={box}
      className={broken ? "pebble broken" : "pebble"}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      data-face-state={state}
      data-face-playing={playing ? "true" : "false"}
      onMouseEnter={reactive ? () => player?.react("hover") : undefined}
      onClick={reactive ? () => player?.react("pat") : undefined}
    >
      <canvas
        ref={canvas}
        width={frame * ratio}
        height={frame * ratio}
        style={{ width: frame, height: frame, left: (size - frame) / 2, bottom: -frame * SHEET.bottom }}
      />
    </span>
  );
}
