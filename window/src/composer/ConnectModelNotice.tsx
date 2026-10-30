import type { OpenTarget } from "./nav";
import { CODEX_MISSING, CODEX_MISSING_ACTION, CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS, openCodexSetup, openConnectModel } from "./connect-model";

/** A connected ChatGPT model that can't answer because Codex is missing (issue 589): one plain line, one button. */
export function CodexMissingNotice({ onOpen, className }: { onOpen?: (target: OpenTarget) => void; className?: string }) {
  const go = () => {
    if (onOpen) onOpen("settings/accounts");
    else openCodexSetup();
  };
  return (
    <div className={className} data-testid="codex-missing" role="status">
      <p>{CODEX_MISSING}</p>
      <div className="connect-model-acts">
        <button type="button" className="connect-model-btn" onClick={go}>{CODEX_MISSING_ACTION}</button>
      </div>
    </div>
  );
}

/** The one control for “no usable model”: the same words everywhere, one primary button. */
export function ConnectModelNotice({ onOpen, onRetry, className }: {
  onOpen?: (target: OpenTarget) => void;
  onRetry?: () => void;
  className?: string;
}) {
  const go = () => {
    if (onOpen) onOpen("settings/accounts/add");
    else openConnectModel();
  };
  return (
    <div className={className} data-testid="connect-model">
      <p>{CONNECT_MODEL_ANSWERS}</p>
      <div className="connect-model-acts">
        <button type="button" className="connect-model-btn" onClick={go}>{CONNECT_MODEL_ACTION}</button>
        {onRetry ? <button type="button" className="r1c-undo" onClick={onRetry}>Try again</button> : null}
      </div>
    </div>
  );
}
