// A test approval the phone asks for itself, so approvals can be checked end to end without a Trunk and without
// changing what the computer lets Trunks run. It is a plugin approval (plugin.approval.request, which needs only
// operator.approvals, the scope this phone already has): nothing is attached to it, so Allow and Deny run nothing.
// The engine shows it to the device that asked and to Branch on the computer (approval-shared.ts
// isApprovalRecordVisibleToClient), and either one can answer it.
//
// It is a developer tool: on in development builds (Expo Go, `expo start`), and in a release build only when it was
// built with EXPO_PUBLIC_BRANCH_TEST_APPROVALS=1 (see README.md).
import type { EngineLink } from '../pairing/pairingSession';

/** The plugin id the test approval carries, so the phone can name it on its card. */
export const TEST_APPROVAL_PLUGIN = 'branch-phone-test';
export const TEST_APPROVAL_TITLE = 'Test approval from this phone';
export const TEST_APPROVAL_DESCRIPTION =
  'Nothing runs, whatever you choose. This only checks that approvals reach this phone and that your answer gets back to your computer.';
/** Long enough to lock the phone, wait for the notification and answer it. The engine's limit is 10 minutes. */
export const TEST_APPROVAL_TIMEOUT_MS = 5 * 60_000;
/** The delayed send: time to lock the phone, so the notification can be checked too. */
export const TEST_APPROVAL_DELAY_MS = 10_000;

export const TEST_NO_WINDOW_MESSAGE =
  'Your computer didn’t keep the test approval because Branch isn’t open there. Open Branch on your computer, then try again.';
export const TEST_FAILED_MESSAGE = 'Your computer didn’t take the test approval. Try again in a moment.';
export const TEST_NOT_ALLOWED_MESSAGE = 'This phone isn’t allowed to ask for approvals any more. Pair it again from Branch on your computer.';
export const TEST_OFFLINE_MESSAGE = 'Your computer isn’t connected right now. Try again when it’s back.';

/** Whether this build shows the test approval tools. */
export function testApprovalsOn(): boolean {
  // EXPO_PUBLIC_ variables are written into the bundle when it is built, so this must stay a literal read.
  return (typeof __DEV__ !== 'undefined' && __DEV__ === true) || process.env.EXPO_PUBLIC_BRANCH_TEST_APPROVALS === '1';
}

export type TestApprovalResult = { ok: true; id: string } | { ok: false; message: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Asks the computer for the test approval. With twoPhase the engine answers at once: { status: 'accepted', id } once
 * the request is shown somewhere, or the final { id, decision: null } when nothing but this phone could show it.
 * The engine leaves the asking connection out of its own *.approval.requested broadcast, so the caller reads the
 * list again to show it here.
 */
export async function sendTestApproval(link: Pick<EngineLink, 'request' | 'hello'>): Promise<TestApprovalResult> {
  if (!link.hello) return { ok: false, message: TEST_OFFLINE_MESSAGE };
  try {
    const result = rec(
      await link.request('plugin.approval.request', {
        pluginId: TEST_APPROVAL_PLUGIN,
        title: TEST_APPROVAL_TITLE,
        description: TEST_APPROVAL_DESCRIPTION,
        severity: 'info',
        allowedDecisions: ['allow-once', 'deny'],
        timeoutMs: TEST_APPROVAL_TIMEOUT_MS,
        twoPhase: true,
      }),
    );
    if (result.status === 'accepted' && typeof result.id === 'string') return { ok: true, id: result.id };
    return { ok: false, message: TEST_NO_WINDOW_MESSAGE };
  } catch (error) {
    const e = rec(error);
    const code = String(e.gatewayCode ?? e.code ?? '');
    if (code === 'FORBIDDEN' || rec(e.details).code === 'MISSING_SCOPE') return { ok: false, message: TEST_NOT_ALLOWED_MESSAGE };
    return { ok: false, message: link.hello ? TEST_FAILED_MESSAGE : TEST_OFFLINE_MESSAGE };
  }
}
