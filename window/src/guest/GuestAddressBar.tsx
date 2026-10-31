// The address bar: Enter goes to an address or searches, a first click selects all, and leaving the bar shows the page's address again.
import { useRef, useState, type RefObject } from "react";

type Props = {
  url: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit(raw: string): void;
};

export function GuestAddressBar({ url, inputRef, onSubmit }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const justFocused = useRef(false);
  const value = draft ?? url;
  return (
    <form
      className="guest-address"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
        setDraft(null);
        inputRef.current?.blur();
      }}
    >
      <input
        ref={inputRef}
        aria-label="Address"
        placeholder="Search or type an address"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          justFocused.current = true;
          event.target.select();
        }}
        onMouseUp={(event) => {
          if (!justFocused.current) return;
          event.preventDefault();
          justFocused.current = false;
        }}
        onBlur={(event) => {
          justFocused.current = false;
          // Focus on the Open button keeps what was typed, so the owner can open the page they typed.
          if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.keepDraft !== undefined) return;
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          setDraft(null);
          event.currentTarget.blur();
        }}
      />
    </form>
  );
}
