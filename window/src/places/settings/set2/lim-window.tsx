// One allowance window as a bar with what's left and when it resets: Settings › Data & usage and Settings › Accounts.
import "./usage.css";

export function LimWindow({ label, left, words }: { label: string; left: number; words: string }) {
  const l = Math.max(0, Math.min(100, left));
  return (
    <div className="s2usage-limw">
      <span>{label}</span>
      <span className="s2usage-limbar" role="meter" aria-label={`${label} left`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l)}><i style={{ width: `${l}%` }} /></span>
      <span>{`${Math.round(l)}% left · ${l >= 100 && !words ? "full" : words}`}</span>
    </div>
  );
}
