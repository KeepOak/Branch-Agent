// Chat app logos: the preview's marks for the apps it draws (base mock LOGO table), each in its brand colour;
// any other app gets the shared two-letter tile from ./service.
import { Logo } from "./service";

const MARKS: Record<string, [string, string]> = {
  telegram: ["#2AABEE", '<path d="M4.8 11.6l13.4-5.2-2.3 11.2-4.4-3.3-2.3 2.3.3-3.5 5.6-5.1-7 4.3z" fill="#fff"/>'],
  whatsapp: ["#25D366", '<path d="M12 4.6a7.4 7.4 0 0 0-6.3 11.3l-1 3.5 3.6-1a7.4 7.4 0 1 0 3.7-13.8z" fill="none" stroke="#fff" stroke-width="1.7"/>'],
  discord: ["#5865F2", '<path d="M7.2 8.4c3-1.3 6.6-1.3 9.6 0l1.4 7.1c-1.6 1.2-3.2 1.8-4.5 2l-.8-1.4m-1.8 0l-.8 1.4c-1.3-.2-2.9-.8-4.5-2z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9.8" cy="12.6" r="1.1" fill="#fff"/><circle cx="14.2" cy="12.6" r="1.1" fill="#fff"/>'],
  slack: ["#4A154B", '<path d="M9 5v14M15 5v14M5 9h14M5 15h14" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'],
};

export function ChatLogo({ id, name, size = 28 }: { id: string; name?: string; size?: number }) {
  const mark = MARKS[id];
  if (!mark) return <Logo id={id} name={name} size={size} />;
  const glyph = Math.round(size * 0.66);
  return (
    <span className="logo" style={{ width: size, height: size, background: mark[0] }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={glyph} height={glyph} dangerouslySetInnerHTML={{ __html: mark[1] }} />
    </span>
  );
}
