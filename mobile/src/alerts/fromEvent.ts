// Map a gateway event the paired phone already hears onto one local notification.
// Mirrors engine/src/gateway/event-web-push.ts resolveEventWebPushNotification (question,
// chat final, cron failed) plus cron success, mentions.list items, and the Android APK update.
import type { AlertKind } from './kinds';
import type { AlertRoute } from './route';

export type PlannedAlert = {
  key: string;
  kind: AlertKind;
  title: string;
  body: string;
  route: AlertRoute;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const clip = (text: string, max = 180) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Branch-authored transcript bookkeeping, not a real reply (engine transcript-only helper). */
export function isTranscriptOnly(message: unknown): boolean {
  const entry = rec(message);
  if (str(entry.role) !== 'assistant') return false;
  if (str(entry.provider) === 'branch' && (str(entry.model) === 'gateway-injected' || str(entry.model) === 'delivery-mirror')) {
    return true;
  }
  const mirror = rec(entry.branchDeliveryMirror);
  return ['channel-final', 'channel-final-suppressed', 'message-tool-source-reply', 'cron-direct-delivery-context'].includes(
    str(mirror.kind),
  );
}

function chatRoute(sessionKey: string | undefined, fallback: AlertRoute): AlertRoute {
  return sessionKey ? { screen: 'chat', sessionKey } : fallback;
}

function questionPrompt(payload: Record<string, unknown>): string {
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  for (const item of questions) {
    const prompt = str(rec(item).question);
    if (prompt) return prompt;
  }
  return '';
}

/** One notification for a live gateway event, or null when that event is not something we post. */
export function alertFromEvent(event: string, payload: unknown): PlannedAlert | { refresh: 'mentions' } | { dismiss: string } | null {
  const value = rec(payload);
  if (event === 'mentions.changed') return { refresh: 'mentions' };
  if (event === 'question.resolved') {
    const id = str(value.id);
    return id ? { dismiss: `question:${id}` } : null;
  }
  if (event === 'question.requested') {
    const id = str(value.id) || 'pending';
    const prompt = questionPrompt(value);
    return {
      key: `question:${id}`,
      kind: 'question',
      title: 'A Trunk needs an answer',
      body: clip(prompt || 'Open Branch to answer.'),
      route: chatRoute(str(value.sessionKey) || undefined, { screen: 'inbox' }),
    };
  }
  if (event === 'chat' && str(value.state) === 'final' && value.yielded !== true && !isTranscriptOnly(value.message)) {
    const runId = str(value.runId) || 'finished';
    const sessionKey = str(value.sessionKey);
    return {
      key: `reply:${runId}`,
      kind: 'finished',
      title: 'A reply is ready',
      body: 'A Trunk finished while you were away.',
      route: chatRoute(sessionKey || undefined, { screen: 'inbox' }),
    };
  }
  if (event === 'cron' && str(value.action) === 'finished') {
    const job = rec(value.job);
    const jobId = str(value.jobId) || str(job.id) || 'job';
    const jobName = str(job.name);
    const sessionKey = str(value.sessionKey) || str(job.sessionKey) || undefined;
    const failed = str(value.status) === 'error';
    return {
      key: `cron:${jobId}:${failed ? 'error' : 'ok'}`,
      kind: failed ? 'automation' : 'finished',
      title: failed ? 'A routine couldn’t finish' : 'A routine finished',
      body: clip(jobName ? (failed ? `${jobName} needs attention.` : `${jobName} finished.`) : failed ? 'A scheduled task needs attention.' : 'A scheduled task finished.'),
      route: chatRoute(sessionKey, { screen: 'inbox' }),
    };
  }
  return null;
}

export function alertFromMention(item: unknown): PlannedAlert | null {
  const value = rec(item);
  const id = str(value.id);
  if (!id) return null;
  const sender = str(value.senderLabel) || 'Someone';
  const title = str(value.sessionTitle);
  const excerpt = str(value.excerpt);
  const sessionKey = str(value.sessionKey);
  return {
    key: `mention:${id}`,
    kind: 'mention',
    title: `${sender} mentioned you`,
    body: clip(excerpt || (title ? `in ${title}` : 'in a conversation you share.')),
    route: chatRoute(sessionKey || undefined, { screen: 'inbox' }),
  };
}

export function alertFromUpdate(version: string): PlannedAlert {
  return {
    key: 'update:apk',
    kind: 'update',
    title: 'Update available',
    body: `Branch ${version} is ready to install.`,
    route: { screen: 'settings' },
  };
}
