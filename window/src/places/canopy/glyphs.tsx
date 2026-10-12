// Line glyphs Canopy needs that the shell's icon set doesn't carry (stroke 1.6, currentColor, like shell/icons).
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function Glyph({ name }: { name: "chat" | "stop" | "eye" | "play" }) {
  return (
    <svg className="cn-g" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" {...P}>
      {name === "chat" ? <path d="M5 5h14v10H9l-4 4z" /> : null}
      {name === "stop" ? <rect x="7" y="7" width="10" height="10" rx="2" /> : null}
      {name === "play" ? <path d="M8 6l10 6-10 6z" /> : null}
      {name === "eye" ? <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></> : null}
    </svg>
  );
}
