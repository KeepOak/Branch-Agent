// Settings › Branch account: the device's Google sign-in. account.status reads it, account.google.signIn runs the
// browser sign-in as a wizard session (wizard.next / wizard.cancel), account.signOut removes it.
import {
  ErrorCodes,
  errorShape,
  validateAccountGoogleSignInParams,
  validateAccountSignOutParams,
  validateAccountStatusParams,
} from "../../../packages/gateway-protocol/src/index.js";
import {
  readGoogleAccountStatus,
  signInWithGoogle,
  signOutOfGoogle,
} from "../../account/branch-account.js";
import { WizardSession } from "../../wizard/session.js";
import { rejectExistingSetupWizardSession } from "./system-agent-setup-wizard.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams, defineValidatedGatewayMethod } from "./validation.js";
import { startWizardLogin } from "./wizard-login.js";

const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

function unavailable(error: unknown) {
  return errorShape(
    ErrorCodes.UNAVAILABLE,
    error instanceof Error ? error.message : "The Branch account could not be changed.",
  );
}

export const accountHandlers: GatewayRequestHandlers = {
  "account.status": defineValidatedGatewayMethod(
    "account.status",
    validateAccountStatusParams,
    async ({ respond }) => {
      respond(true, { google: await readGoogleAccountStatus() }, undefined);
    },
    unavailable,
  ),
  "account.google.signIn": async ({ params, respond, context, client }) => {
    if (
      !assertValidParams(
        params,
        validateAccountGoogleSignInParams,
        "account.google.signIn",
        respond,
      )
    ) {
      return;
    }
    const reject = (message: string) =>
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    if (!client || !client.connect.scopes?.includes("operator.admin")) {
      reject("Signing in to Branch requires an administrator connection.");
      return;
    }
    // Google answers on this computer's loopback address, so the browser that signs in must be on this computer.
    if (client.internal?.isLocalClient !== true) {
      reject("Sign in from Branch on the computer this Gateway runs on.");
      return;
    }
    const status = await readGoogleAccountStatus();
    if (!status.available) {
      reject(status.reason ?? "Google sign-in isn't available here.");
      return;
    }
    if (rejectExistingSetupWizardSession({ sessionId: params.sessionId, context, respond })) {
      return;
    }
    await startWizardLogin({
      client,
      context,
      sessionId: params.sessionId,
      respond,
      assertCurrent: () => {
        client.connectionSignal?.throwIfAborted();
        if (client.invalidated || !client.connect.scopes?.includes("operator.admin")) {
          throw new Error("Sign-in authority is no longer active.");
        }
      },
      createSession: () =>
        new WizardSession(
          async (prompter, signal, runner) => {
            await signInWithGoogle({
              openUrl: async (url) => {
                await prompter.openUrl?.(url);
              },
              signal,
              timeoutMs: SIGN_IN_TIMEOUT_MS,
              beforeSave: () => runner.lockCancellation(),
            });
          },
          { timeoutMs: SIGN_IN_TIMEOUT_MS },
        ),
    });
  },
  "account.signOut": defineValidatedGatewayMethod(
    "account.signOut",
    validateAccountSignOutParams,
    async ({ respond }) => {
      respond(true, { google: await signOutOfGoogle() }, undefined);
    },
    unavailable,
  ),
};
