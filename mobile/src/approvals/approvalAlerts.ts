// Approvals reach the phone as notifications. While Branch is in the background (or the screen is
// locked), each new approval posts one notification with the Trunk's name, what it wants, and real
// Allow and Deny buttons ("Send it" and "Don’t send" for a request that sends). A button answers it on
// the computer without opening the app; tapping the notification opens Needs you at that approval.
// When the approval is answered anywhere, its notification goes away and the app badge counts down.
import { notificationText, actionWords } from './approvalWords';
import { trunkOf, type ApprovalDecision, type ApprovalInbox, type Approval } from './approvals';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';
/** Two sets of buttons: Allow and Deny, or Send it and Don’t send. */
export type AlertCategory = 'approval' | 'approval-send';
export type AlertResponse = { approvalId: string; action: 'allow' | 'deny' | 'open' };

/** The phone's notification system, as the alerts use it. expoNotifier.ts is the real one. */
export type Notifier = {
  /** Registers the button sets (and Android's channel). Safe to call more than once. */
  prepare(): Promise<void>;
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  show(alert: { key: string; title: string; body: string; category?: AlertCategory; approvalId?: string }): Promise<void>;
  dismiss(key: string): Promise<void>;
  setBadge(count: number): Promise<void>;
  /** A button or a tap on one of Branch's notifications. */
  onResponse(listener: (response: AlertResponse) => void): () => void;
  /** The tap that launched the app, if it was opened from a notification. */
  launchResponse(): Promise<AlertResponse | null>;
};

export type AppStateSource = {
  current(): string;
  onChange(listener: (state: string) => void): () => void;
};

export const alertKey = (approvalId: string) => `approval:${approvalId}`;
const failedKey = (approvalId: string) => `approval-failed:${approvalId}`;

export function categoryFor(approval: Approval): AlertCategory {
  return actionWords(approval).yes === 'Send it' ? 'approval-send' : 'approval';
}

export class ApprovalAlerts {
  private readonly shown = new Set<string>();
  private readonly offs: Array<() => void> = [];
  private badge = -1;
  private prepared: Promise<void> | null = null;

  constructor(
    private readonly inbox: ApprovalInbox,
    private readonly notifier: Notifier,
    private readonly appState: AppStateSource,
    private readonly onOpen: (approvalId: string) => void,
  ) {}

  attach(): void {
    // Everything already waiting when the app starts has been seen on screen or in an earlier notification.
    for (const approval of this.inbox.getSnapshot().pending) this.shown.add(approval.id);
    this.offs.push(
      this.inbox.subscribe(() => void this.sync()),
      this.notifier.onResponse((response) => void this.respond(response)),
      this.appState.onChange((state) => {
        // Back in front: read again in case the computer's socket slept with the phone.
        if (state === 'active') void this.inbox.refresh();
      }),
    );
    void this.notifier.launchResponse().then((response) => response && this.respond(response), () => undefined);
    void this.sync();
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private prepare(): Promise<void> {
    this.prepared ??= this.notifier.prepare().catch(() => undefined);
    return this.prepared;
  }

  private async sync(): Promise<void> {
    const { pending, trunks } = this.inbox.getSnapshot();
    const ids = new Set(pending.map((a) => a.id));
    const away = this.appState.current() !== 'active';
    const work: Promise<void>[] = [];
    for (const approval of pending) {
      if (this.shown.has(approval.id)) continue;
      this.shown.add(approval.id);
      if (!away) continue;
      const { title, body } = notificationText(approval, trunkOf(approval, trunks).name);
      work.push(this.prepare().then(() => this.notifier.show({ key: alertKey(approval.id), title, body, category: categoryFor(approval), approvalId: approval.id })));
    }
    for (const id of [...this.shown]) {
      if (ids.has(id)) continue;
      this.shown.delete(id);
      work.push(this.notifier.dismiss(alertKey(id)));
    }
    if (pending.length !== this.badge) {
      this.badge = pending.length;
      work.push(this.notifier.setBadge(pending.length));
    }
    await Promise.all(work.map((p) => p.catch(() => undefined)));
  }

  private async respond({ approvalId, action }: AlertResponse): Promise<void> {
    if (action === 'open') {
      this.onOpen(approvalId);
      return;
    }
    const decision: ApprovalDecision = action === 'allow' ? 'allow-once' : 'deny';
    const ok = await this.inbox.answer(approvalId, decision);
    if (ok || !this.inbox.getSnapshot().failed[approvalId]) return;
    // It is still waiting: say so where the person is looking, and let a tap bring them to it.
    await this.notifier
      .show({ key: failedKey(approvalId), title: 'Your answer didn’t reach your computer', body: 'Open Branch to try again.', approvalId })
      .catch(() => undefined);
  }
}
