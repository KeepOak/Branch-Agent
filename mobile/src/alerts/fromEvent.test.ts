import { alertFromEvent, alertFromMention, alertFromUpdate, isTranscriptOnly } from './fromEvent';

describe('gateway events to notification copy and route', () => {
  it('opens the chat when a reply finishes, and skips yielded or injected transcript rows', () => {
    expect(
      alertFromEvent('chat', { state: 'final', runId: 'run-1', sessionKey: 'agent:oak:main' }),
    ).toEqual({
      key: 'reply:run-1',
      kind: 'finished',
      title: 'A reply is ready',
      body: 'A Trunk finished while you were away.',
      route: { screen: 'chat', sessionKey: 'agent:oak:main' },
    });
    expect(alertFromEvent('chat', { state: 'final', runId: 'run-1', yielded: true })).toBeNull();
    expect(
      alertFromEvent('chat', {
        state: 'final',
        runId: 'inject-1',
        message: { role: 'assistant', provider: 'branch', model: 'gateway-injected' },
      }),
    ).toBeNull();
    expect(isTranscriptOnly({ role: 'assistant', provider: 'branch', model: 'delivery-mirror' })).toBe(true);
  });

  it('opens Inbox for a question with no chat, and the chat when the engine named one', () => {
    expect(alertFromEvent('question.requested', { id: 'q1', questions: [{ question: 'Which folder?' }] })).toEqual({
      key: 'question:q1',
      kind: 'question',
      title: 'A Trunk needs an answer',
      body: 'Which folder?',
      route: { screen: 'inbox' },
    });
    expect(alertFromEvent('question.requested', { id: 'q2', sessionKey: 'agent:oak:chat-1' })).toMatchObject({
      route: { screen: 'chat', sessionKey: 'agent:oak:chat-1' },
    });
    expect(alertFromEvent('question.resolved', { id: 'q1' })).toEqual({ dismiss: 'question:q1' });
  });

  it('posts a routine finished and a routine failed, and deep-links the session when present', () => {
    expect(
      alertFromEvent('cron', { action: 'finished', status: 'ok', jobId: 'nightly', job: { name: 'Nightly filing' } }),
    ).toEqual({
      key: 'cron:nightly:ok',
      kind: 'finished',
      title: 'A routine finished',
      body: 'Nightly filing finished.',
      route: { screen: 'inbox' },
    });
    expect(
      alertFromEvent('cron', {
        action: 'finished',
        status: 'error',
        jobId: 'nightly',
        sessionKey: 'agent:main:cron:daily',
        job: { name: 'Nightly filing' },
      }),
    ).toMatchObject({
      key: 'cron:nightly:error',
      kind: 'automation',
      title: 'A routine couldn’t finish',
      body: 'Nightly filing needs attention.',
      route: { screen: 'chat', sessionKey: 'agent:main:cron:daily' },
    });
  });

  it('opens the mentioned chat, and Settings for an update that is ready', () => {
    expect(
      alertFromMention({
        id: 'm1',
        senderLabel: 'Dana',
        sessionKey: 'agent:oak:room:launch',
        sessionTitle: 'Launch team',
        excerpt: 'can you confirm?',
      }),
    ).toEqual({
      key: 'mention:m1',
      kind: 'mention',
      title: 'Dana mentioned you',
      body: 'can you confirm?',
      route: { screen: 'chat', sessionKey: 'agent:oak:room:launch' },
    });
    expect(alertFromEvent('mentions.changed', { revision: 1 })).toEqual({ refresh: 'mentions' });
    expect(alertFromUpdate('0.2.0')).toEqual({
      key: 'update:apk',
      kind: 'update',
      title: 'Update available',
      body: 'Branch 0.2.0 is ready to install.',
      route: { screen: 'settings' },
    });
  });
});
