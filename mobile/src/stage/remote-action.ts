/** What the person did, in the remote screen's pixels. Copied from window/src/stage/DriveSurface.tsx. */
export type RemoteAction =
  | { kind: "click"; x: number; y: number; button: "left" | "right" }
  | { kind: "move"; x: number; y: number }
  | { kind: "drag"; fromX: number; fromY: number; x: number; y: number }
  | { kind: "scroll"; x: number; y: number; dx: number; dy: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string };
