// Events the desktop already surfaces as notices, posted as local Android notifications
// while Branch is in the background. Approvals stay on ApprovalAlerts; this follows the
// same notifier, Android channels, and tap routing. A closed app still cannot hear the
// computer (see mobile/DESIGN.md).
import type { EngineLink } from '../pairing/pairingSession';
import type { PhonePrefs } from '../settings/phonePrefs';
import { PHONE_PREFS_DEFAULT } from '../settings/phonePrefs';
import type { UpdateFlowState } from '../updates/updateFlow';
import type { AppStateSource, Notifier } from '../approvals/approvalAlerts';
import { CHANNEL_FOR_KIND, shouldPostAlert, type AlertKind } from './kinds';
import { alertFromEvent, alertFromMention, alertFromUpdate, type PlannedAlert } from './fromEvent';

export type AlertPrefs = () => PhonePrefs | Promise<PhonePrefs>;

export class EventAlerts {
  private readonly offs: Array<() => void> = [];
  private readonly shown = new Set<string>();
  private prepared: Promise<void> | null = null;
  private mentionIds = new Set<string>();
  private mentionsReady = false;
  private mentionWork: Promise<void> = Promise.resolve();
  private lastUpdate: Pick<UpdateFlowState, 'status'> & { offer?: { version: string } } | null = null;

  constructor(
    private readonly link: EngineLink,
    private readonly notifier: Notifier,
    private readonly appState: AppStateSource,
    private readonly prefs: AlertPrefs = async () => PHONE_PREFS_DEFAULT,
  ) {}

  attach(): void {
    this.offs.push(
      this.link.onEvent((event, payload) => void this.onEvent(event, payload)),
      this.link.onConnected(() => void this.queueMentions(() => this.primeMentions())),
      this.appState.onChange((state) => {
        if (state !== 'active' && this.lastUpdate) void this.notifyUpdate(this.lastUpdate);
      }),
    );
    if (this.link.hello) void this.queueMentions(() => this.primeMentions());
  }

  private queueMentions(task: () => Promise<void>): Promise<void> {
    this.mentionWork = this.mentionWork.then(task, task);
    return this.mentionWork;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  /** Sideloaded Android APK: post once when an update becomes ready while the app is away. */
  async notifyUpdate(state: Pick<UpdateFlowState, 'status'> & { offer?: { version: string } }): Promise<void> {
    this.lastUpdate = state;
    if (state.status !== 'available' || !state.offer) {
      if (this.shown.has('update:apk')) {
        this.shown.delete('update:apk');
        await this.notifier.dismiss('update:apk').catch(() => undefined);
      }
      return;
    }
    await this.post(alertFromUpdate(state.offer.version));
  }

  private prepare(): Promise<void> {
    this.prepared ??= this.notifier.prepare().catch(() => undefined);
    return this.prepared;
  }

  private async allowed(kind: AlertKind): Promise<boolean> {
    const prefs = await Promise.resolve(this.prefs()).catch(() => PHONE_PREFS_DEFAULT);
    return shouldPostAlert(prefs, kind, this.appState.current());
  }

  private async post(alert: PlannedAlert): Promise<void> {
    if (this.shown.has(alert.key)) return;
    if (!(await this.allowed(alert.kind))) return;
    this.shown.add(alert.key);
    await this.prepare();
    await this.notifier
      .show({
        key: alert.key,
        title: alert.title,
        body: alert.body,
        channel: CHANNEL_FOR_KIND[alert.kind],
        route: alert.route,
      })
      .catch(() => undefined);
  }

  private async onEvent(event: string, payload: unknown): Promise<void> {
    const planned = alertFromEvent(event, payload);
    if (!planned) return;
    if ('refresh' in planned) {
      await this.queueMentions(() => this.refreshMentions());
      return;
    }
    if ('dismiss' in planned) {
      this.shown.delete(planned.dismiss);
      await this.notifier.dismiss(planned.dismiss).catch(() => undefined);
      return;
    }
    await this.post(planned);
  }

  private async primeMentions(): Promise<void> {
    const items = await this.listMentions();
    this.mentionIds = new Set(items.map((item) => item.id).filter(Boolean));
    this.mentionsReady = true;
  }

  private async refreshMentions(): Promise<void> {
    const items = await this.listMentions();
    const next = new Set(items.map((item) => item.id).filter(Boolean));
    const known = this.mentionsReady;
    this.mentionsReady = true;
    for (const item of items) {
      if (!item.id) continue;
      if (known && !this.mentionIds.has(item.id)) {
        const alert = alertFromMention(item);
        if (alert) await this.post(alert);
      }
    }
    this.mentionIds = next;
  }

  private async listMentions(): Promise<Array<{ id: string } & Record<string, unknown>>> {
    try {
      const result = await this.link.request('mentions.list', {});
      const items = (result as { items?: unknown } | null)?.items;
      if (!Array.isArray(items)) return [];
      return items.map((item) => {
        const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        return { ...rec, id: typeof rec.id === 'string' ? rec.id : '' };
      });
    } catch {
      return [];
    }
  }
}
