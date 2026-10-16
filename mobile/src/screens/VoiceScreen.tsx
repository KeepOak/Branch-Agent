import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Approval, ApprovalDecision } from '../approvals/approvals';
import { actionWords } from '../approvals/approvalWords';
import type { ChatRow } from '../chats/chatList';
import type { EngineLink } from '../pairing/pairingSession';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import {
  CALL_UNAVAILABLE,
  OFFLINE_VOICE,
  STATE_WORDS,
  VOICE_CHOICES,
  VoiceCall,
  voiceError,
  type CallState,
  type VoiceChoice,
} from '../voice/voiceCall';
import { spokenAnswer } from '../voice/spokenAnswer';

/** Black and white call chrome (r50 default). No green glow, no orange rings. */
const voice = {
  bg: '#000000',
  ink: '#ffffff',
  ink2: '#c9d1d8',
  ink3: '#9aa4ad',
  fill: 'rgba(255,255,255,0.12)',
  ring: 'rgba(255,255,255,0.35)',
} as const;

function VoiceAvatar({ row, size }: { row: ChatRow; size: number }) {
  return (
    <View
      testID="voice-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: voice.fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ThemedText variant="title1" style={{ color: voice.ink, lineHeight: size * 0.45 }}>
        {row.avatar}
      </ThemedText>
    </View>
  );
}

function Round({
  testID,
  label,
  pressed,
  onPress,
  large = false,
  inverted = false,
  slashed = false,
  children,
}: {
  testID: string;
  label: string;
  pressed?: boolean;
  onPress: () => void;
  large?: boolean;
  inverted?: boolean;
  slashed?: boolean;
  children: string;
}) {
  const { layout } = useTheme();
  const size = large ? 68 : 56;
  const on = inverted || pressed;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ pressed: Boolean(pressed) }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed: down }) => ({
        width: size,
        height: size,
        minWidth: layout.rowMinHeight,
        minHeight: layout.rowMinHeight,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? voice.ink : voice.fill,
        opacity: down ? 0.7 : 1,
      })}
    >
      <ThemedText variant={large ? 'title1' : 'title3'} style={{ color: on ? voice.bg : voice.ink, fontWeight: '500' }}>
        {children}
      </ThemedText>
      {slashed ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            width: 26,
            height: 2,
            backgroundColor: on ? voice.bg : voice.ink,
            transform: [{ rotate: '-45deg' }],
            borderRadius: 1,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Still waiting, and this decision is one the request allows. */
export function canAnswer(approval: Approval, decision: ApprovalDecision, now: number): boolean {
  if (approval.expiresAtMs && approval.expiresAtMs <= now) return false;
  return approval.allowedDecisions.includes(decision);
}

/** The oldest approval still waiting in this conversation. */
export function waitingAsk(pending: Approval[], sessionKey: string, now: number): Approval | null {
  return pending.find((a) => a.sessionKey === sessionKey && (!a.expiresAtMs || a.expiresAtMs > now)) ?? null;
}

function sayWord(ask: Approval): string {
  return actionWords(ask).yes === 'Send it' ? 'send it' : 'yes';
}

/**
 * Android Voice (preview phone §4.11.8 / PG18): full-screen talk with this Trunk, Mute, Speaker, End,
 * Keyboard, a Voice menu (Oak / Birch), and this conversation's own approval. Black and white by default.
 */
export function VoiceScreen({
  row,
  online,
  link,
  pending = [],
  now = Date.now(),
  onAnswer,
  onClose,
  onEnd,
  onKeyboard,
}: {
  row: ChatRow;
  online: boolean;
  link: EngineLink;
  pending?: Approval[];
  now?: number;
  onAnswer?: (id: string, decision: ApprovalDecision) => void;
  onClose: () => void;
  onEnd: () => void;
  onKeyboard: () => void;
}) {
  const { space, radius, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<CallState>(online ? 'starting' : 'error');
  const [message, setMessage] = useState<string | null>(online ? null : OFFLINE_VOICE);
  const [userLine, setUserLine] = useState('');
  const [assistantLine, setAssistantLine] = useState('');
  const [muted, setMuted] = useState(false);
  const [speakerOff, setSpeakerOff] = useState(false);
  const [voiceName, setVoiceName] = useState<VoiceChoice>('Oak');
  const [menuOpen, setMenuOpen] = useState(false);
  const call = useRef<VoiceCall | null>(null);
  const ask = waitingAsk(pending, row.key, now);
  const askRef = useRef(ask);
  askRef.current = ask;
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;

  const finish = useCallback(
    async (how: 'close' | 'end' | 'keyboard') => {
      setMenuOpen(false);
      await call.current?.end();
      call.current = null;
      if (how === 'keyboard') onKeyboard();
      else if (how === 'end') onEnd();
      else onClose();
    },
    [onClose, onEnd, onKeyboard],
  );

  useEffect(() => {
    if (!online) return;
    const next = new VoiceCall(link, row.key, {
      onState: (s, m) => {
        setState(s);
        if (m) setMessage(m);
      },
      onCaption: (role, text) => {
        if (role === 'user') {
          setUserLine(text);
          const waiting = askRef.current;
          const said = waiting ? spokenAnswer(text) : null;
          if (waiting && said && answerRef.current && canAnswer(waiting, said, Date.now())) {
            answerRef.current(waiting.id, said);
          }
        } else setAssistantLine(text);
      },
    });
    call.current = next;
    next.start().catch((e: unknown) => {
      setState('error');
      setMessage(voiceError(e) === 'Your computer isn’t connected right now.' ? OFFLINE_VOICE : CALL_UNAVAILABLE);
    });
    return () => {
      void next.end();
      if (call.current === next) call.current = null;
    };
  }, [link, row.key, online]);

  const broken = !online || state === 'error';
  const caption = broken ? message ?? OFFLINE_VOICE : assistantLine || STATE_WORDS[state];
  const allow = ask && onAnswer && canAnswer(ask, 'allow-once', now);

  return (
    <View testID="voice-screen" style={{ flex: 1, backgroundColor: voice.bg }}>
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.xl,
          paddingHorizontal: layout.screenInset,
          alignItems: 'center',
        }}
      >
        <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Round testID="voice-close" label="Close" onPress={() => void finish('close')}>
            ⌄
          </Round>
          {broken ? null : (
            <Round testID="voice-more" label="Voice" onPress={() => setMenuOpen((v) => !v)}>
              ⋯
            </Round>
          )}
          <ThemedText testID="voice-title" variant="subhead" numberOfLines={1} style={{ flex: 1, color: voice.ink2, textAlign: 'center' }}>
            {row.title} · voice
          </ThemedText>
          <ThemedText testID="voice-on-phone" variant="caption1" style={{ color: voice.ink3 }}>
            On this phone
          </ThemedText>
        </View>

        <View testID="voice-orb" style={{ width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginTop: space.xl }}>
          <View
            style={{
              position: 'absolute',
              width: 200,
              height: 200,
              borderRadius: 100,
              borderWidth: 2,
              borderColor: voice.ring,
              opacity: 0.35,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: 168,
              height: 168,
              borderRadius: 84,
              borderWidth: 2,
              borderColor: voice.ring,
              opacity: 0.55,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: 136,
              height: 136,
              borderRadius: 68,
              borderWidth: 2,
              borderColor: voice.ring,
              opacity: 0.8,
            }}
          />
          <VoiceAvatar row={row} size={110} />
        </View>

        <View testID="voice-caption" style={{ width: '100%', marginTop: space.xl, gap: space.sm, alignItems: 'center' }}>
          {userLine && !broken ? (
            <ThemedText variant="subhead" style={{ color: voice.ink3, textAlign: 'center' }}>
              {userLine}
            </ThemedText>
          ) : null}
          <ThemedText
            variant="callout"
            accessibilityRole={broken ? 'alert' : undefined}
            style={{ color: voice.ink, textAlign: 'center' }}
          >
            {caption}
          </ThemedText>
        </View>

        {allow ? (
          <Pressable
            testID="voice-ask"
            accessibilityRole="button"
            accessibilityLabel={`Say “${sayWord(ask)}” to answer ${row.title}`}
            onPress={() => onAnswer(ask.id, 'allow-once')}
            style={({ pressed }) => ({
              marginTop: space.lg,
              paddingHorizontal: space.lg,
              paddingVertical: space.sm + 2,
              borderRadius: radius.pill,
              backgroundColor: voice.fill,
              opacity: pressed ? 0.7 : 1,
              minHeight: layout.rowMinHeight,
              justifyContent: 'center',
            })}
          >
            <ThemedText variant="subhead" style={{ color: voice.ink, fontWeight: '600' }}>
              Say “{sayWord(ask)}” to answer {row.title}
            </ThemedText>
          </Pressable>
        ) : null}

        <View style={{ flex: 1 }} />

        <View testID="voice-controls" style={{ flexDirection: 'row', alignItems: 'center', gap: 26, paddingBottom: space.sm }}>
          {broken ? (
            <Round testID="voice-end" label="Close" large inverted onPress={() => void finish('end')}>
              ×
            </Round>
          ) : (
            <>
              <Round
                testID="voice-mute"
                label={muted ? 'Unmute' : 'Mute'}
                pressed={muted}
                slashed={muted}
                onPress={() => {
                  const next = !muted;
                  call.current?.mute(next);
                  setMuted(next);
                }}
              >
                ◉
              </Round>
              <Round
                testID="voice-speaker"
                label={speakerOff ? 'Turn the speaker on' : 'Speaker'}
                pressed={speakerOff}
                slashed={speakerOff}
                onPress={() => setSpeakerOff((v) => !v)}
              >
                ≈
              </Round>
              <Round testID="voice-end" label="End" large inverted onPress={() => void finish('end')}>
                ×
              </Round>
              <Round testID="voice-keyboard" label="Keyboard" onPress={() => void finish('keyboard')}>
                ⌨
              </Round>
            </>
          )}
        </View>
      </View>

      {menuOpen ? (
        <View testID="voice-menu" accessibilityViewIsModal style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, justifyContent: 'flex-end' }}>
          <Pressable testID="voice-menu-dismiss" accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setMenuOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
          <View
            style={{
              backgroundColor: voice.bg,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.14)',
              paddingHorizontal: layout.screenInset,
              paddingBottom: insets.bottom + space.lg,
              paddingTop: space.md,
            }}
          >
            <ThemedText variant="headline" style={{ color: voice.ink, marginBottom: space.sm }}>
              Voice
            </ThemedText>
            <ScrollView testID="voice-menu-list" showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
              {VOICE_CHOICES.map((name) => {
                const on = voiceName === name;
                return (
                  <Pressable
                    key={name}
                    testID={`voice-choice-${name}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={name}
                    onPress={() => {
                      setVoiceName(name);
                      setMenuOpen(false);
                    }}
                    style={({ pressed }) => ({
                      minHeight: layout.rowMinHeight,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <ThemedText variant="body" style={{ color: voice.ink }}>
                      {name}
                    </ThemedText>
                    {on ? (
                      <ThemedText variant="body" style={{ color: voice.ink }}>
                        ✓
                      </ThemedText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <ThemedText variant="footnote" style={{ color: voice.ink3, marginTop: space.sm }}>
              Changing it changes the voice everywhere.
            </ThemedText>
          </View>
        </View>
      ) : null}
    </View>
  );
}
