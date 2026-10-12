// Logos for the connectors and sign-ins setup names (the preview's LOGO table: Outlook, Google Drive, GitHub, Gmail),
// each in its brand colour with a white mark.
export type ToolMark = "outlook" | "drive" | "github" | "gmail";

const MARKS: Record<ToolMark, [string, string]> = {
  outlook: ["#0F6CBD", "O"],
  drive: ["#1FA463", '<path d="M8.6 4h6.8l5.2 9-3.4 6H6.8l-3.4-6z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.6 4l5.2 9h6.8M3.4 13h10.4l3.4 6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>'],
  github: ["#181717", '<path d="M12 4a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 12 4z" fill="#fff"/>'],
  gmail: ["#EA4335", '<path d="M4 7l8 6 8-6M4 7v10h16V7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>'],
};

export function ToolLogo({ id, size }: { id: ToolMark; size: number }) {
  const [bg, mark] = MARKS[id];
  return (
    <span className="logo" style={{ width: size, height: size, background: bg }} aria-hidden="true">
      {mark.startsWith("<") ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.66)} height={Math.round(size * 0.66)} dangerouslySetInnerHTML={{ __html: mark }} />
      ) : (
        <b style={{ font: `700 ${Math.max(6, Math.round(size * 0.38))}px var(--sans)`, color: "#fff" }}>{mark}</b>
      )}
    </span>
  );
}
