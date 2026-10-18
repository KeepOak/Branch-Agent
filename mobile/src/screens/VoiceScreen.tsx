import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, type TextProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Approval, ApprovalDecision } from '../approvals/approvals';
import { actionWords } from '../approvals/approvalWords';
import type { ChatRow } from '../chats/chatList';
import type { EngineLink } from '../pairing/pairingSession';
import { useTheme } from '../theme/ThemeProvider';
import { NoScrollbarScrollView as ScrollView } from '../ui/NoScrollbar';
import { voice, voiceRadius, voiceSans, voiceType, type VoiceTypeName } from '../voice/chrome';
import { later, shows, type Level } from '../voice/level';
import { spokenAnswer } from '../voice/spokenAnswer';
import {
  CALL_UNAVAILABLE,
  NOT_CONNECTED,
  OFFLINE_VOICE,
  VoiceCall,
  voiceError,
  voiceWord,
  type CallState,
} from '../voice/voiceCall';

function VoiceText({
  size,
  color = voice.ink,
  weight,
  style,
  ...rest
}: TextProps & { size: VoiceTypeName; color?: string; weight?: '400' | '500' | '600' }) {
  return <Text {...rest} style={[voiceType[size], { color, fontFamily: voiceSans, fontWeight: weight ?? voiceType[size].fontWeight }, style]} />;
}

function VoiceAvatar({ row, size }: { row: ChatRow; size: number }) {
  return (
    <View
      testID="voice-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: voice.gcFill,
        borderWidth: 1,
        borderColor: voice.gcEdge,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <VoiceText size="fs26" style={{ lineHeight: size * 0.45 }}>
        {row.avatar}
      </VoiceText>
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
      accessibilityState={{ selected: Boolean(pressed) }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed: down }) => ({
        width: size,
        height: size,
        minWidth: layout.rowMinHeight,
        minHeight: layout.rowMinHeight,
        borderRadius: voiceRadius.pill,
        borderWidth: inverted ? 0 : 1,
        borderColor: voice.gcEdge,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? (inverted ? voice.ink : voice.gkOn) : voice.gcFill,
        opacity: down ? 0.7 : 1,
      })}
    >
      <VoiceText size={large ? 'fs26' : 'fs17'} color={on && inverted ? voice.bg : voice.ink} weight="500">
        {children}
      </VoiceText>
      {slashed ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            width: 26,
            height: 2,
            backgroundColor: on && inverted ? voice.bg : voice.ink,
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
 * Android Voice: full-screen talk with this Trunk. States Listening, Thinking, Speaking, Muted,
 * Not connected; the transcript; mute, speaker, end and keyboard. Black and white with the
 * desktop's type, glass and radii. Unfinished features use later() and only show at Advanced+.
 */
export function VoiceScreen({
  row,
  online,
  link,
  pending = [],
  now = Date.now(),
  level = 'regular',
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
  level?: Level;
  onAnswer?: (id: string, decision: ApprovalDecision) => void;
  onClose: () => void;
  onEnd: () => void;
  onKeyboard: () => void;
}) {
  const { space, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<CallState>(online ? 'starting' : 'error');
  const [message, setMessage] = useState<string | null>(null);
  const [userLine, setUserLine] = useState('');
  const [assistantLine, setAssistantLine] = useState('');
  const [muted, setMuted] = useState(false);
  const [speakerOff, setSpeakerOff] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const call = useRef<VoiceCall | null>(null);
  const ask = waitingAsk(pending, row.key, now);
  const askRef = useRef(ask);
  askRef.current = ask;
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;
  const extra = shows(level, 'advanced');

  const finish = useCallback(
    (how: 'close' | 'end' | 'keyboard') => {
      setMenuOpen(false);
      const running = call.current;
      call.current = null;
      void running?.end();
      if (how === 'keyboard') onKeyboard();
      else if (how === 'end') onEnd();
      else onClose();
    },
    [onClose, onEnd, onKeyboard],
  );

  useEffect(() => {
    if (!online) return;
    let live = true;
    const next = new VoiceCall(link, row.key, {
      onState: (s, m) => {
        if (!live) return;
        setState(s);
        if (m) setMessage(m);
      },
      onCaption: (role, text) => {
        if (!live) return;
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
      if (!live || call.current !== next) return;
      setState('error');
      setMessage(voiceError(e) === 'Your computer isn’t connected right now.' ? OFFLINE_VOICE : CALL_UNAVAILABLE);
    });
    return () => {
      live = false;
      void next.end();
      if (call.current === next) call.current = null;
    };
  }, [link, row.key, online]);

  const broken = !online || state === 'error';
  const word = broken ? NOT_CONNECTED : voiceWord(state, muted);
  const note = extra && broken ? (message ?? OFFLINE_VOICE) : null;
  const allow = ask && onAnswer && canAnswer(ask, 'allow-once', now);
  const hasTranscript = Boolean((userLine || assistantLine) && !broken);

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
          <Round testID="voice-close" label="Close" onPress={() => finish('close')}>
            ⌄
          </Round>
          {extra && !broken ? (
            <Round testID="voice-more" label="Voice" onPress={() => setMenuOpen((v) => !v)}>
              ⋯
            </Round>
          ) : null}
          <VoiceText testID="voice-title" size="fs15" color={voice.ink2} numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
            {row.title} · voice
          </VoiceText>
          <VoiceText testID="voice-on-phone" size="fs12" color={voice.ink3}>
            On this phone
          </VoiceText>
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

        <VoiceText
          testID="voice-state"
          size="fs17"
          accessibilityRole={broken ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
          style={{ marginTop: space.xl, textAlign: 'center' }}
        >
          {word}
        </VoiceText>
        {note ? (
          <VoiceText testID="voice-note" size="fs13" color={voice.ink3} style={{ marginTop: space.sm, textAlign: 'center' }}>
            {note}
          </VoiceText>
        ) : null}

        {hasTranscript ? (
          <ScrollView
            testID="voice-transcript"
            style={{ width: '100%', maxHeight: 140, marginTop: space.md }}
            contentContainerStyle={{ gap: space.sm, alignItems: 'center' }}
          >
            {userLine ? (
              <VoiceText size="fs15" color={voice.ink3} style={{ textAlign: 'center' }}>
                {userLine}
              </VoiceText>
            ) : null}
            {assistantLine ? (
              <VoiceText size="fs17" style={{ textAlign: 'center' }}>
                {assistantLine}
              </VoiceText>
            ) : null}
          </ScrollView>
        ) : null}

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
              borderRadius: voiceRadius.pill,
              backgroundColor: voice.gkChip,
              borderWidth: 1,
              borderColor: voice.gcEdge,
              opacity: pressed ? 0.7 : 1,
              minHeight: layout.rowMinHeight,
              justifyContent: 'center',
            })}
          >
            <VoiceText size="fs15" weight="600">
              Say “{sayWord(ask)}” to answer {row.title}
            </VoiceText>
          </Pressable>
        ) : null}

        <View style={{ flex: 1 }} />

        <View testID="voice-controls" style={{ flexDirection: 'row', alignItems: 'center', gap: 26, paddingBottom: space.sm }}>
          {broken ? (
            <Round testID="voice-end" label="Close" large inverted onPress={() => finish('end')}>
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
              <Round testID="voice-end" label="End" large inverted onPress={() => finish('end')}>
                ×
              </Round>
              <Round testID="voice-keyboard" label="Keyboard" onPress={() => finish('keyboard')}>
                ⌨
              </Round>
            </>
          )}
        </View>
      </View>

      {menuOpen ? (
        <View testID="voice-menu" accessibilityViewIsModal style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, justifyContent: 'flex-end' }}>
          <Pressable testID="voice-menu-dismiss" accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setMenuOpen(false)} style={{ flex: 1, backgroundColor: voice.scrim }} />
          <View
            style={{
              backgroundColor: voice.bg,
              borderTopLeftRadius: voiceRadius.r4,
              borderTopRightRadius: voiceRadius.r4,
              borderTopWidth: 1,
              borderColor: voice.gfEdge,
              paddingHorizontal: layout.screenInset,
              paddingBottom: insets.bottom + space.lg,
              paddingTop: space.md,
            }}
          >
            <VoiceText size="fs17" weight="600" style={{ marginBottom: space.sm }}>
              Voice
            </VoiceText>
            <VoiceText testID="voice-later" size="fs15" color={voice.ink3}>
              {later('Voice')}
            </VoiceText>
          </View>
        </View>
      ) : null}
    </View>
  );
}
