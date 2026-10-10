// "Can't connect: reason and fix steps" (DESIGN-SPEC "gateway-connect-diagnostics"): the engine's connect error code
// in plain words, after OpenClaw's ui/src/components/login-gate-feedback.ts. The raw error stays in a Technical fold.

export type Problem = { title: string; line: string; steps: string[]; needsKey: boolean };

/** `host` is the address without its scheme, for example "127.0.0.1:18789". */
export function connectProblem(code: string | undefined, host: string): Problem {
  const key = (title: string, line: string, steps: string[]): Problem => ({ title, line, steps, needsKey: true });
  const plain = (title: string, line: string, steps: string[]): Problem => ({ title, line, steps, needsKey: false });
  switch (code) {
    case "AUTH_REQUIRED":
    case "AUTH_TOKEN_MISSING":
    case "AUTH_PASSWORD_MISSING":
      return key(`${host} needs its key`, `${host} answers, but needs the matching key before this window can connect.`, [
        "Paste the key from `branch gateway auth-token --show` into Gateway key.",
        "Or type the password set for that computer.",
        "Then choose Connect again.",
      ]);
    case "AUTH_TOKEN_NOT_CONFIGURED":
    case "AUTH_PASSWORD_NOT_CONFIGURED":
      return key(`${host} needs its key`, `${host} answers, but needs the matching key before this window can connect.`, [
        "No key set? Create one on that computer.",
        "Then choose Connect again.",
      ]);
    case "AUTH_TOKEN_MISMATCH":
    case "AUTH_PASSWORD_MISMATCH":
    case "AUTH_UNAUTHORIZED":
    case "AUTH_DEVICE_TOKEN_MISMATCH":
      return key(`${host} refused this key`, "Check it belongs to this computer.", [
        "Run `branch dashboard --no-open` for a fresh link, or `branch gateway auth-token --show` to see the key.",
        "Replace the key with the one for this address.",
      ]);
    case "AUTH_BOOTSTRAP_TOKEN_INVALID":
      return plain("This link no longer works", "It expired or was already used. Ask for a fresh link; don't change the key.", [
        "Open the fresh link `branch dashboard` prints. Links work once and expire after ten minutes.",
      ]);
    case "AUTH_RATE_LIMITED":
      return plain("Too many tries", `${host} is pausing sign-ins from here for a moment.`, ["Stop retrying for a moment.", "Wait, then connect with the right key."]);
    case "OPERATOR_ACCESS_DENIED":
      return plain(`No access to ${host}`, "You're signed in, but this computer hasn't given your account access, or it has ended.", [
        "Ask an admin to give you a role.",
        "This connects by itself once access is given.",
      ]);
    case "CONTROL_UI_ORIGIN_NOT_ALLOWED":
      return plain("This address isn't allowed", "That computer refused this window's origin.", ["Add it to gateway.controlUi.allowedOrigins, using full origins, then restart the gateway."]);
    case "PROTOCOL_MISMATCH":
    case "CLIENT_VERSION_MISMATCH":
    case "CONTROL_UI_BUILD_MISMATCH":
      return plain("Versions don't match", "This window and that computer speak different versions.", ["Update Branch on both."]);
    default:
      return key(`${host} didn't answer`, "Nothing was changed.", ["Check that Branch is running on that computer, then choose Connect again."]);
  }
}

/** "127.0.0.1:18789" from "ws://127.0.0.1:18789". */
export function hostOf(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}
