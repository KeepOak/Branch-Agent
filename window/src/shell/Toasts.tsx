import { useEffect, useRef, useSyncExternalStore } from "react";
import { useDesktopAppliedUpdateNotice } from "../connect/desktop-component-updates";
import { dismiss, getToasts, subscribeToasts, TOAST_MS, type Toast } from "./notify";

/** One toast: 6 s, paused while hovered or focused; × closes it (DESIGN-SPEC §2.7, §5.11). */
function ToastItem({ toast }: { toast: Toast }) {
  const left = useRef(TOAST_MS);
  const started = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pause = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      left.current -= Date.now() - started.current;
    }
  };
  const resume = () => {
    if (!timer.current) {
      started.current = Date.now();
      timer.current = setTimeout(() => dismiss(toast.id), Math.max(left.current, 0));
    }
  };
  useEffect(() => {
    resume();
    return pause;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per toast
  }, []);

  return (
    <div
      className={toast.tone === "bad" ? "toast bad" : "toast"}
      role="status"
      data-testid="toast"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <div className="toast-text">
        <span>{toast.text}</span>
        {toast.line ? <small>{toast.line}</small> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          className="toast-act"
          onClick={() => {
            toast.action?.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" className="toast-x" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(toast.id)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
    </div>
  );
}

export function Toasts({ setupOpen = false }: { setupOpen?: boolean }) {
  useDesktopAppliedUpdateNotice();
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  const visible = setupOpen ? toasts.find((toast) => toast.tone === "bad") : toasts[0];
  return (
    <div className="toasts" aria-live="polite">
      {visible ? <ToastItem key={visible.id} toast={visible} /> : null}
    </div>
  );
}
