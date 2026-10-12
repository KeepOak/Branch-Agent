import type { ControlUiHost } from "branch/plugin-sdk/control-ui";

let activeHost: ControlUiHost | undefined;
let redact: (text: string) => string = () => "Canopy is not active.";

export function bindCanopyHost(host: ControlUiHost): () => void {
  activeHost = host;
  redact = host.redact;
  return () => {
    if (activeHost === host) {
      activeHost = undefined;
    }
  };
}

export function canopyRedact(text: string): string {
  // Error completions can arrive during teardown; redaction carries no host authority.
  return redact(text);
}

export function canopyHost(): ControlUiHost {
  if (!activeHost || activeHost.signal.aborted) {
    throw new Error("Canopy is no longer active. Reload the plugin to continue.");
  }
  return activeHost;
}

export function canopyLocale(): string {
  return (
    activeHost?.locale ||
    (typeof document === "undefined" ? "en" : document.documentElement.lang) ||
    "en"
  );
}
