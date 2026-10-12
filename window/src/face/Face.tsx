import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentState } from "./agentState";
import { SHEET } from "./painter";
import { FacePlayer } from "./player";
import "./face.css";
import { useTrunkAppearance, useTrunkPebbleLook, useTrunkEmojiFace, completePebbleLook, mergePebbleLook, type PebbleLook } from "./appearance";
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
  pebbleLook?: PebbleLook;
  /** The computer the agent is on, so two agents with the same name on different computers get different looks. */
  where?: string;
};

/** At 24 px and smaller the face is the flat pebble: the colour in its shape with two white eyes (§6.3). */
function FlatPebble({ size, label, state, look }: { size: number; label?: string; state: AgentState; look?: PebbleLook }) {
  return (
    <span
      className={state === "sleep" ? "flat-pebble asleep" : "flat-pebble"}
      style={{ width: size, height: size, background: look?.colour, borderRadius: ["50%", "58% 42% 54% 46% / 52% 56% 44% 48%", "46% 54% 42% 58% / 60% 44% 56% 40%", "62% 38% 50% 50% / 45% 55% 45% 55%", "42% 58% 58% 42% / 50% 42% 58% 50%"][Math.max(0, ["Circle", "Stone", "Leaf", "Acorn", "Shield"].indexOf(look?.shape || "Circle"))] } as CSSProperties}
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
  const contextLook = useTrunkPebbleLook(props.label);
  // Every pebble gets its colour, shape and eyes, falling back to the name's nature look (never the grey placeholder).
  const pebbleLook = completePebbleLook(mergePebbleLook(props.pebbleLook, contextLook), props.label, props.where);
  const emoji = useTrunkEmojiFace(props.label);
  const look = useLookPrefs();
  const shown = { ...props, state: shownState(props.state ?? "idle", look), reactive: Boolean(props.reactive) && look.reactsToTouch };
  return appearance ? <CharacterFace {...shown} appearance={appearance} /> : emoji ? <span className="emoji-pebble" role="img" aria-label={props.label} style={{ width: props.size, height: props.size, background: pebbleLook.colour, fontSize: Math.round(props.size * 0.56) }}>{emoji}</span> : <ClassicFace {...shown} pebbleLook={pebbleLook} />;
}

/** The state a face plays under Appearance › Characters: "Acts out what it is doing" off keeps it still (asleep stays
 *  asleep), "Moves while it speaks" off keeps it still while it talks. */
export function shownState(state: AgentState, look: Pick<LookPrefs, "actsOut" | "movesWhileSpeaking">): AgentState {
  if (state === "talk" && !look.movesWhileSpeaking) return "idle";
  if (!look.actsOut && state !== "sleep" && state !== "talk") return "idle";
  return state;
}

function ClassicFace({ size, label, state = "idle", priority = 0, reactive = false, pebbleLook }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const [player, setPlayer] = useState<FacePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!canvas.current) {
      return;
    }
    const p = new FacePlayer(canvas.current, { colour: pebbleLook?.colour, shape: ["Circle", "Stone", "Leaf", "Acorn", "Shield"].indexOf(pebbleLook?.shape || "Circle"), eyes: (pebbleLook?.eyes || "Round").toLowerCase() });
    p.onPlaying = setPlaying;
    p.onError = () => setBroken(true);
    p.showStill().catch(() => setBroken(true));
    setPlayer(p);
    return () => p.dispose();
  }, [pebbleLook?.colour, pebbleLook?.shape, pebbleLook?.eyes]);
  useEffect(() => {
    if (player) {
      player.priority = priority;
      player.setState(state);
    }
  }, [player, state, priority]);
  useThemeRepaint(player);
  useVisibility(player, box.current);
  if (size <= 24) {
    return <FlatPebble size={size} label={label} state={state} look={pebbleLook} />;
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
