import { useState, useSyncExternalStore } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { phaseLabel, type ChatItem, type Conversation, type ConversationSnapshot, type LiveReply, type OwnSend } from '../chat/conversation';
import type { ChatRow } from '../chats/chatList';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Avatar } from './ChatsScreen';

/** "12s", "3 min", "1 h 5 min": how long a turn worked. */
export function workedFor(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

type Line =
  | { kind: 'item'; key: string; item: ChatItem }
  | { kind: 'send'; key: string; send: OwnSend }
  | { kind: 'live'; key: string; live: LiveReply }
  | { kind: 'ended'; key: string; text: string; failed: boolean };

/** Everything the chat shows, oldest first: the history, your messages on their way, how a reply ended, the live reply. */
export function chatLines(snapshot: ConversationSnapshot): Line[] {
  const lines: Line[] = snapshot.items.map((item) => ({ kind: 'item', key: item.key, item }));
  for (const send of snapshot.sends) lines.push({ kind: 'send', key: `send:${send.id}`, send });
  if (snapshot.ended && snapshot.live?.runId !== snapshot.ended.runId) lines.push({ kind: 'ended', key: `ended:${snapshot.ended.runId}`, text: snapshot.ended.text, failed: snapshot.ended.failed });
  if (snapshot.live) lines.push({ kind: 'live', key: `live:${snapshot.live.runId}`, live: snapshot.live });
  return lines;
}

function Bubble({ mine, text, testID, faded = false }: { mine: boolean; text: string; testID?: string; faded?: boolean }) {
  const { color, space, radius } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '82%',
        backgroundColor: mine ? color.accent : color.raise,
        borderRadius: radius.bubble,
        borderBottomRightRadius: mine ? space.xs + 2 : radius.bubble,
        borderBottomLeftRadius: mine ? radius.bubble : space.xs + 2,
        paddingHorizontal: space.md + 2,
        paddingVertical: space.sm + 1,
        opacity: faded ? 0.6 : 1,
      }}
    >
      <ThemedText variant="body" tone={mine ? 'onAccent' : 'ink'} selectable>
        {text}
      </ThemedText>
    </View>
  );
}

/** A turn's steps as one quiet line; a tap lists them. */
function WorkLine({ item }: { item: Extract<ChatItem, { kind: 'work' }> }) {
  const { space } = useTheme();
  const [open, setOpen] = useState(false);
  const count = item.steps.length;
  const label = `Worked for ${workedFor(item.durationMs)} · ${count} ${count === 1 ? 'step' : 'steps'}`;
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <Pressable
        testID={`work-${item.key}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', paddingHorizontal: space.xs, opacity: pressed ? 0.6 : 1 })}
      >
        <ThemedText variant="footnote" tone="ink3">
          {label} {open ? '▾' : '›'}
        </ThemedText>
      </Pressable>
      {open ? (
        <View testID={`steps-${item.key}`} style={{ paddingLeft: space.md, paddingBottom: space.xs, gap: space.xxs }}>
          {item.steps.map((step, i) => (
            <ThemedText key={i} variant="footnote" tone="ink2">
              {i + 1}. {step}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Notice({ text, failed, testID }: { text: string; failed: boolean; testID?: string }) {
  const { color, space, radius } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole={failed ? 'alert' : undefined}
      style={{
        alignSelf: failed ? 'stretch' : 'center',
        backgroundColor: failed ? color.badTint : 'transparent',
        borderRadius: radius.md,
        paddingHorizontal: space.md,
        paddingVertical: failed ? space.sm : space.xxs,
      }}
    >
      <ThemedText variant="footnote" tone={failed ? 'bad' : 'ink3'} style={{ textAlign: failed ? 'left' : 'center' }}>
        {text}
      </ThemedText>
    </View>
  );
}

function SendLine({ send, onRetry }: { send: OwnSend; onRetry: (id: string) => void }) {
  const { space } = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', gap: space.xxs }}>
      <Bubble mine text={send.text} faded={send.state === 'sending'} testID={`send-${send.id}`} />
      {send.state === 'failed' ? (
        <Pressable testID={`retry-${send.id}`} accessibilityRole="button" onPress={() => onRetry(send.id)} hitSlop={8} style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <ThemedText variant="footnote" tone="bad">
            Not sent: {send.error ?? 'your computer didn’t answer'}. Tap to try again.
          </ThemedText>
        </Pressable>
      ) : send.state === 'sending' ? (
        <ThemedText variant="caption1" tone="ink3">
          Sending…
        </ThemedText>
      ) : null}
    </View>
  );
}

/** The reply being written: its words as they arrive, or what the Trunk is doing before the first one. */
function LiveBubble({ live }: { live: LiveReply }) {
  const { color, space, radius } = useTheme();
  if (live.text) return <Bubble mine={false} text={live.text} testID="live-reply" />;
  return (
    <View
      testID="live-reply"
      accessibilityLiveRegion="polite"
      style={{ alignSelf: 'flex-start', backgroundColor: color.raise, borderRadius: radius.bubble, borderBottomLeftRadius: space.xs + 2, paddingHorizontal: space.md + 2, paddingVertical: space.sm + 1 }}
    >
      <ThemedText variant="body" tone="ink3">
        {phaseLabel(live.phase)}
      </ThemedText>
    </View>
  );
}

/** Grey bubbles in the shape of a chat until the first read lands: never a blank screen. */
function Skeleton() {
  const { color, space, radius, layout } = useTheme();
  const shapes: Array<[boolean, number]> = [[false, 70], [true, 45], [false, 82], [true, 30], [false, 60]];
  return (
    <View testID="chat-loading" accessibilityLabel="Loading this chat" style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: layout.screenInset, paddingBottom: space.md, gap: space.md }}>
      {shapes.map(([mine, width], i) => (
        <View key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: `${width}%`, height: 38, borderRadius: radius.bubble, backgroundColor: mine ? color.accentTint : color.fill }} />
      ))}
    </View>
  );
}

function Empty({ title, body, testID, action }: { title: string; body: string; testID: string; action?: { title: string; onPress: () => void } }) {
  const { space, layout } = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: layout.screenInset + space.lg, gap: space.sm }}>
      <ThemedText variant="title3" style={{ textAlign: 'center' }}>
        {title}
      </ThemedText>
      <ThemedText variant="subhead" tone="ink2" style={{ textAlign: 'center' }}>
        {body}
      </ThemedText>
      {action ? (
        <View style={{ marginTop: space.md, alignSelf: 'stretch' }}>
          <Button title={action.title} kind="secondary" onPress={action.onPress} testID={`${testID}-action`} />
        </View>
      ) : null}
    </View>
  );
}

/** One chat: the history, the reply streaming in live, and a composer pinned above the keyboard. */
export function ChatScreen({ row, conversation, online, onBack }: { row: ChatRow; conversation: Conversation; online: boolean; onBack: () => void }) {
  const { color, space, radius, layout, type } = useTheme();
  const insets = useSafeAreaInsets();
  const snapshot = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const [draft, setDraft] = useState('');
  const lines = chatLines(snapshot);
  const live = snapshot.live;
  const status = live ? (live.text ? 'Typing…' : phaseLabel(live.phase)) : !online ? 'Reconnecting…' : row.room ? 'Room' : row.trunkName ? `With ${row.trunkName}` : '';
  const canSend = online && !live && draft.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    const text = draft;
    setDraft('');
    void conversation.send(text);
  };

  let body;
  if (lines.length) {
    body = (
      <FlatList
        testID="chat-messages"
        inverted
        data={[...lines].reverse()}
        keyExtractor={(line) => line.key}
        renderItem={({ item: line }) => {
          if (line.kind === 'send') return <SendLine send={line.send} onRetry={(id) => void conversation.retry(id)} />;
          if (line.kind === 'live') return <LiveBubble live={line.live} />;
          if (line.kind === 'ended') return <Notice text={line.text} failed={line.failed} testID="reply-ended" />;
          const item = line.item;
          if (item.kind === 'user') return <Bubble mine text={item.text} testID={`msg-${item.key}`} />;
          if (item.kind === 'assistant') return <Bubble mine={false} text={item.text} testID={`msg-${item.key}`} />;
          if (item.kind === 'work') return <WorkLine item={item} />;
          return <Notice text={item.text} failed={item.kind === 'error'} testID={`msg-${item.key}`} />;
        }}
        contentContainerStyle={{ paddingHorizontal: layout.screenInset - space.xs, paddingVertical: space.md, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      />
    );
  } else if (!snapshot.loaded && !snapshot.error) {
    body = <Skeleton />;
  } else if (!snapshot.loaded) {
    body = online ? (
      <Empty testID="chat-error" title="Couldn’t load this chat" body={snapshot.error ?? ''} action={{ title: 'Try again', onPress: () => void conversation.load() }} />
    ) : (
      <Empty testID="chat-waiting" title="Waiting for your computer" body="This chat shows up as soon as this phone reaches it." />
    );
  } else {
    body = <Empty testID="chat-empty" title={`Say hello to ${row.title}`} body={`What you send here goes to ${row.trunkName ?? row.title} on your computer.`} />;
  }

  return (
    <KeyboardAvoidingView testID="chat-screen" behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={{ paddingTop: insets.top, borderBottomWidth: layout.hairline, borderBottomColor: color.line, backgroundColor: color.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.sm, gap: space.sm }}>
          <Pressable
            testID="chat-back"
            accessibilityRole="button"
            accessibilityLabel="Back to Chats"
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => ({ minWidth: layout.rowMinHeight, minHeight: layout.rowMinHeight, justifyContent: 'center', paddingHorizontal: space.xs, opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText variant="title2" tone="accentInk" style={{ fontWeight: '400' }}>
              {Platform.OS === 'android' ? '←' : '‹'}
            </ThemedText>
          </Pressable>
          <Avatar row={row} size={38} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText variant="headline" numberOfLines={1} accessibilityRole="header">
              {row.title}
            </ThemedText>
            {status ? (
              <ThemedText testID="chat-status" variant="footnote" tone={live ? 'accentInk' : !online ? 'warn' : 'ink3'} numberOfLines={1} accessibilityLiveRegion="polite">
                {status}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </View>
      <View style={{ flex: 1 }}>{body}</View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: layout.screenInset - space.xs, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm, borderTopWidth: layout.hairline, borderTopColor: color.line, backgroundColor: color.bg }}>
        <TextInput
          testID="composer"
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder={online ? `Message ${row.title}` : 'Waiting for your computer…'}
          placeholderTextColor={color.ink3}
          accessibilityLabel={`Message ${row.title}`}
          style={{ ...type.body, flex: 1, color: color.ink, backgroundColor: color.fill, borderRadius: radius.bubble, paddingHorizontal: space.md + 2, paddingTop: space.sm + 1, paddingBottom: space.sm + 1, minHeight: 40, maxHeight: 140 }}
        />
        {live ? (
          <Pressable
            testID="stop-reply"
            accessibilityRole="button"
            accessibilityLabel="Stop the reply"
            disabled={!online}
            onPress={() => void conversation.stop()}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center', opacity: !online ? 0.45 : pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 13, height: 13, borderRadius: 3, backgroundColor: color.bg }} />
          </Pressable>
        ) : (
          <Pressable
            testID="send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center', opacity: !canSend ? 0.4 : pressed ? 0.7 : 1 })}
          >
            <ThemedText variant="headline" tone="onAccent" style={{ fontWeight: '700' }}>
              ↑
            </ThemedText>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
