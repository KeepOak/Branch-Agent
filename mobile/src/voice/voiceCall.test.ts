import { waitFor } from '@testing-library/react-native';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { MUTED, NOT_CONNECTED, VoiceCall, voiceWord } from './voiceCall';

const KEY = 'agent:main:main';
const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });

async function paired() {
  const engine = createFakeEngine();
  const { session } = createFakeSession(engine);
  session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  return { engine, session };
}

describe('VoiceCall', () => {
  it('opens a realtime talk session and closes it', async () => {
    const { engine, session } = await paired();
    const states: string[] = [];
    const call = new VoiceCall(session, KEY, { onState: (s) => states.push(s), onCaption: () => undefined });
    await call.start();
    expect(engine.requests.some((r) => r.method === 'talk.session.create')).toBe(true);
    expect(states).toEqual(['starting', 'listening']);
    await call.end();
    expect(engine.requests.some((r) => r.method === 'talk.session.close')).toBe(true);
    expect(states.at(-1)).toBe('ended');
    session.dispose();
  });

  it('forwards captions from talk.event', async () => {
    const { engine, session } = await paired();
    const captions: Array<[string, string]> = [];
    const call = new VoiceCall(session, KEY, {
      onState: () => undefined,
      onCaption: (role, text) => captions.push([role, text]),
    });
    await call.start();
    const created = engine.requests.find((r) => r.method === 'talk.session.create');
    expect(created).toBeDefined();
    engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'transcript', role: 'user', text: 'Is the invoice right?' });
    engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'transcript', role: 'assistant', text: 'It looks like the late fee.' });
    await eventually(() => expect(captions).toEqual([
      ['user', 'Is the invoice right?'],
      ['assistant', 'It looks like the late fee.'],
    ]));
    await call.end();
    session.dispose();
  });

  it('maps toolCall to thinking, assistant captions to speaking, and audio to speaking', async () => {
    const { engine, session } = await paired();
    const states: string[] = [];
    const call = new VoiceCall(session, KEY, { onState: (s) => states.push(s), onCaption: () => undefined });
    await call.start();
    engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'toolCall', name: 'branch_agent_consult' });
    engine.emit('talk.event', { relaySessionId: 'talk-1', type: 'audio', audioBase64: 'AA==' });
    await eventually(() => expect(states).toEqual(['starting', 'listening', 'thinking', 'speaking']));
    await call.end();
    session.dispose();
  });

  it('names Listening, Thinking, Speaking, Muted and Not connected', () => {
    expect(voiceWord('listening', false)).toBe('Listening');
    expect(voiceWord('starting', false)).toBe('Listening');
    expect(voiceWord('thinking', false)).toBe('Thinking');
    expect(voiceWord('speaking', false)).toBe('Speaking');
    expect(voiceWord('listening', true)).toBe(MUTED);
    expect(voiceWord('speaking', true)).toBe('Speaking');
    expect(voiceWord('error', false)).toBe(NOT_CONNECTED);
  });
});

