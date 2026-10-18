import type { EngineLink } from '../pairing/pairingSession';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export type CallState = 'starting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error';

export type CallEvents = {
  onState: (state: CallState, message?: string) => void;
  onCaption: (role: 'user' | 'assistant', text: string) => void;
};

/** Why the engine said no, in the phone's words. Never the engine's raw text at Regular. */
export function voiceError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const CALL_UNAVAILABLE = 'Live voice isn’t available right now.';
export const OFFLINE_VOICE = 'No voice service is reachable: your computer isn’t connected.';
export const OFFLINE_VOICE_START = 'Couldn’t start live voice';

/** r50 Voice states: Listening, Thinking, Speaking, Muted, Not connected. Starting maps to Listening. */
export const MUTED = 'Muted';
export const NOT_CONNECTED = 'Not connected';

export const STATE_WORDS: Record<CallState, string> = {
  starting: 'Listening',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  ended: 'Listening',
  error: 'Not connected',
};

/**
 * The word the screen shows for this call. Muted replaces Listening; Thinking and Speaking still show
 * while the Trunk is working, even if the microphone is off.
 */
export function voiceWord(state: CallState, muted: boolean): string {
  if (state === 'error') return NOT_CONNECTED;
  if (state === 'thinking') return STATE_WORDS.thinking;
  if (state === 'speaking') return STATE_WORDS.speaking;
  if (muted) return MUTED;
  return STATE_WORDS.listening;
}

/**
 * A live Talk session through the engine, as the window's VoiceCall does
 * (window/src/composer/voice.ts): talk.session.create in realtime mode, captions from talk.event.
 * This phone has no Web Audio graph, so it does not pump the microphone or play PCM; Mute still
 * stops us treating the call as live-to-the-engine, and captions still arrive. Assistant captions
 * and audio events are Speaking; a consult toolCall is Thinking.
 */
export class VoiceCall {
  private relay = '';
  private muted = false;
  private off: (() => void) | null = null;
  private ended = false;
  voice = '';

  constructor(
    private link: EngineLink,
    private sessionKey: string,
    private on: CallEvents,
  ) {}

  get isMuted(): boolean {
    return this.muted;
  }

  async start(): Promise<void> {
    this.on.onState('starting');
    this.off = this.link.onEvent((event, payload) => event === 'talk.event' && this.event(rec(payload)));
    const made = rec(
      await this.link.request('talk.session.create', {
        sessionKey: this.sessionKey,
        mode: 'realtime',
        transport: 'gateway-relay',
        brain: 'agent-consult',
        capabilities: ['voice-selection'],
      }),
    );
    this.relay = str(made.relaySessionId) || str(made.sessionId);
    if (this.ended) return this.closeLate();
    this.voice = str(made.voice);
    this.on.onState('listening');
  }

  mute(on: boolean) {
    this.muted = on;
  }

  async end(): Promise<void> {
    this.ended = true;
    this.off?.();
    this.off = null;
    if (this.relay) await this.link.request('talk.session.close', { sessionId: this.relay }).catch(() => undefined);
    this.relay = '';
    this.on.onState('ended');
  }

  private async closeLate() {
    const late = this.relay;
    this.relay = '';
    if (late) await this.link.request('talk.session.close', { sessionId: late }).catch(() => undefined);
  }

  private event(p: Record<string, unknown>) {
    if (this.relay && str(p.relaySessionId) !== this.relay && str(p.sessionId) !== this.relay) return;
    const type = p.type;
    if (type === 'ready') this.on.onState('listening');
    else if (type === 'audio') this.on.onState('speaking');
    else if (type === 'transcript' && (p.role === 'user' || p.role === 'assistant') && str(p.text)) {
      this.on.onCaption(p.role, str(p.text));
      this.on.onState(p.role === 'assistant' ? 'speaking' : 'listening');
    } else if (type === 'toolCall') this.on.onState('thinking');
    else if (type === 'error') this.on.onState('error', str(p.message) || 'The voice service stopped.');
    else if (type === 'close') void this.end();
  }
}
