import { useState, useSyncExternalStore } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  actionFields,
  actionWords,
  headline,
  isExpired,
  maskCommand,
} from '../approvals/approvalWords';
import type { Approval, ApprovalDecision } from '../approvals/approvals';
import {
  canSendAttachments,
  formatSize,
  NO_ATTACH_METHOD_NOTE,
  preparingLine,
  readPickedFile,
  resolvedAttachmentPolicy,
  toChatAttachments,
  type DraftFile,
  type HelloAttachments,
  type PickedFile,
} from '../chat/attachments';
import { phaseLabel, type ChatItem, type Conversation, type ConversationSnapshot, type LiveReply, type OwnSend } from '../chat/conversation';
import { attachFailure, expoPickers, type AttachmentPickers } from '../chat/pickAttachment';
import type { ChatRow } from '../chats/chatList';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { NoScrollbarFlatList as FlatList, NoScrollbarScrollView as ScrollView } from '../ui/NoScrollbar';
import { OfflineBanner } from '../ui/OfflineBanner';
import { plainError } from '../ui/plainError';
import { tapHaptic } from '../settings/phoneEffects';
import { Avatar } from './ChatsScreen';

/** "12s", "3 min", "1 h 5 min": how long a turn worked. */
export function workedFor(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

const COMPUTER_STEPS_SHOWN = 5;
/** Same cut as Inbox (`ApprovalsScreen` LONG_COMMAND): a command this long gets an expand control. */
const LONG_COMMAND = 160;

/** Status words on the Take control strip (preview p50sStrip). Rooms have no strip. */
export function takeControlCopy(input: { room: boolean; working: boolean; live: boolean; online: boolean; yours?: boolean }): { state: string; liveOn: boolean } | null {
  if (input.room) return null;
  if (input.yours) return { state: 'You have the computer', liveOn: false };
  if (input.working || input.live) return { state: 'Working on its computer', liveOn: true };
  if (!input.online) return { state: 'Computer idle', liveOn: false };
  return { state: 'Computer ready', liveOn: false };
}

/** The strip does not guess a step total; the engine does not send one. */
export function takeControlDetail(_items: readonly ChatItem[], _working: boolean): string {
  return '';
}

/** Pending approvals that belong in this chat, still waiting. */
export function threadApprovals(pending: readonly Approval[], sessionKey: string, now: number): Approval[] {
  return pending.filter((approval) => approval.sessionKey === sessionKey && !isExpired(approval, now));
}

type Line =
  | { kind: 'item'; key: string; item: ChatItem }
  | { kind: 'send'; key: string; send: OwnSend }
  | { kind: 'live'; key: string; live: LiveReply }
  | { kind: 'ended'; key: string; text: string; failed: boolean }
  | { kind: 'ask'; key: string; approval: Approval };

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
            Not sent: {send.error ?? 'your computer didn’t answer.'} Tap to try again.
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

/** The reply being written: its words as they arrive, or one quiet working line before the first one. */
function LiveBubble({ live }: { live: LiveReply }) {
  if (live.text) return <Bubble mine={false} text={live.text} testID="live-reply" />;
  return (
    <View testID="live-reply" accessibilityLiveRegion="polite" style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
      <ThemedText variant="footnote" tone="ink3">
        {phaseLabel(live.phase)}
      </ThemedText>
    </View>
  );
}

/** Entry point for the computer pane. The pane itself is another screen; this only opens Computers. */
function TakeControlStrip({
  computerName,
  state,
  liveOn,
  detail,
  onTakeControl,
}: {
  computerName: string;
  state: string;
  liveOn: boolean;
  detail: string;
  onTakeControl: () => void;
}) {
  const { color, space, radius } = useTheme();
  return (
    <View
      testID="take-control-strip"
      accessibilityRole="summary"
      accessibilityLabel={`${computerName}: ${state}${detail}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.sm,
        marginHorizontal: space.md,
        marginBottom: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: 14,
        backgroundColor: color.fill,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 }}>
        <View testID="take-control-live" style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: liveOn ? color.ok : color.ink3 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText variant="footnote" numberOfLines={1} style={{ fontWeight: '600' }}>
            {state}
          </ThemedText>
          <ThemedText variant="caption1" tone="ink3" numberOfLines={1}>
            {computerName}
            {detail}
          </ThemedText>
        </View>
      </View>
      <Pressable
        testID="take-control"
        accessibilityRole="button"
        accessibilityLabel="Take control"
        onPress={onTakeControl}
        style={({ pressed }) => ({
          paddingHorizontal: space.md,
          paddingVertical: space.xs + 2,
          borderRadius: radius.pill,
          backgroundColor: color.ink,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <ThemedText variant="footnote" style={{ fontWeight: '600', color: color.bg }}>
          Take control
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** A computer or browser turn: Used computer, the action count, the steps, and Watch or Open computer. */
function ComputerMessage({
  item,
  computerName,
  working,
  onOpen,
}: {
  item: Extract<ChatItem, { kind: 'computer' }>;
  computerName: string;
  working: boolean;
  onOpen: () => void;
}) {
  const { color, space, radius } = useTheme();
  const count = item.steps.length;
  const extra = count > COMPUTER_STEPS_SHOWN ? count - COMPUTER_STEPS_SHOWN : 0;
  const shown = extra ? item.steps.slice(0, COMPUTER_STEPS_SHOWN) : item.steps;
  const action = working ? 'Watch' : 'Open computer';
  return (
    <View
      testID={`computer-${item.key}`}
      accessibilityLabel={`Used computer, ${count} ${count === 1 ? 'action' : 'actions'}`}
      style={{ alignSelf: 'stretch', backgroundColor: color.raise, borderRadius: radius.lg, padding: space.md, gap: space.xs }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <ThemedText variant="footnote" style={{ fontWeight: '600' }}>
          Used computer
        </ThemedText>
        <ThemedText variant="caption1" tone="ink3" style={{ marginLeft: 'auto' }}>
          {count} {count === 1 ? 'action' : 'actions'}
        </ThemedText>
      </View>
      <ThemedText variant="caption1" tone="ink2">
        {computerName} · {item.title}
      </ThemedText>
      <View testID={`computer-steps-${item.key}`} style={{ marginTop: space.xs, gap: 3 }}>
        {shown.map((step, i) => (
          <ThemedText key={i} variant="footnote" tone="ink2">
            {step}
          </ThemedText>
        ))}
        {extra ? (
          <ThemedText variant="footnote" tone="ink3">
            {`+${extra} more`}
          </ThemedText>
        ) : null}
      </View>
      <Pressable
        testID={`computer-open-${item.key}`}
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onOpen}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          marginTop: space.xs,
          paddingHorizontal: space.md,
          paddingVertical: space.xs + 2,
          borderRadius: radius.pill,
          backgroundColor: working ? color.ink : color.fill,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <ThemedText variant="footnote" style={{ fontWeight: '600', color: working ? color.bg : color.ink }}>
          {action}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** An approval waiting in this chat: the question, the full ask, Allow or Deny. */
function ThreadApprovalCard({
  approval,
  sending,
  failed,
  onAnswer,
}: {
  approval: Approval;
  sending?: ApprovalDecision;
  failed?: string;
  onAnswer: (id: string, decision: ApprovalDecision) => void;
}) {
  const { color, space, radius } = useTheme();
  const [all, setAll] = useState(false);
  const verbs = actionWords(approval);
  const parsed = approval.kind === 'plugin' ? actionFields(approval.description ?? '') : { fields: [] as [string, string][], body: '' };
  const command = approval.kind === 'exec' ? maskCommand(approval.command) : '';
  const long = command.length > LONG_COMMAND;
  const busy = Boolean(sending);
  // Allow waits until the ask is on the card: a plugin body (or its field rows), or a non-empty command.
  const canAllow = approval.kind === 'plugin' ? Boolean(parsed.body || parsed.fields.length) : command.trim().length > 0;
  const allowDisabled = busy || !canAllow;
  return (
    <View
      testID={`approval-${approval.id}`}
      accessibilityLabel={headline(approval)}
      style={{ alignSelf: 'stretch', backgroundColor: color.raise, borderRadius: radius.lg, padding: space.md, gap: space.xs }}
    >
      <ThemedText variant="footnote" style={{ fontWeight: '600' }}>
        {headline(approval)}
      </ThemedText>
      {parsed.fields.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', gap: space.sm }}>
          <ThemedText variant="footnote" tone="ink3" style={{ minWidth: 56 }}>
            {k}
          </ThemedText>
          <ThemedText variant="footnote" style={{ flex: 1 }}>
            {v}
          </ThemedText>
        </View>
      ))}
      {parsed.body ? (
        <ThemedText testID={`ask-body-${approval.id}`} variant="footnote" tone="ink2">
          {parsed.body}
        </ThemedText>
      ) : null}
      {approval.kind === 'exec' ? (
        <>
          <ThemedText testID={`command-${approval.id}`} variant="footnote" tone="ink2" numberOfLines={all || !long ? undefined : 4}>
            {command}
          </ThemedText>
          {long ? (
            <Pressable
              testID={`command-more-${approval.id}`}
              accessibilityRole="button"
              onPress={() => setAll((v) => !v)}
              hitSlop={8}
              style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}
            >
              <ThemedText variant="footnote" tone="accentInk">
                {all ? 'Show less' : 'Show the whole command'}
              </ThemedText>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {failed ? (
        <ThemedText testID={`failed-${approval.id}`} variant="footnote" tone="bad">
          {failed}
        </ThemedText>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
        <Pressable
          testID={`deny-${approval.id}`}
          accessibilityRole="button"
          accessibilityLabel={verbs.no}
          accessibilityState={{ disabled: busy, busy: sending === 'deny' }}
          disabled={busy}
          onPress={() => {
            tapHaptic();
            onAnswer(approval.id, 'deny');
          }}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 40,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space.md,
            paddingVertical: space.xs + 2,
            borderRadius: radius.pill,
            backgroundColor: color.fill,
            opacity: busy ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <ThemedText variant="footnote" style={{ fontWeight: '600' }}>
            {verbs.no}
          </ThemedText>
        </Pressable>
        <Pressable
          testID={`allow-${approval.id}`}
          accessibilityRole="button"
          accessibilityLabel={verbs.yes}
          accessibilityState={{ disabled: allowDisabled, busy: sending === 'allow-once' }}
          disabled={allowDisabled}
          onPress={() => {
            if (!canAllow) return;
            tapHaptic();
            onAnswer(approval.id, 'allow-once');
          }}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 40,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space.md,
            paddingVertical: space.xs + 2,
            borderRadius: radius.pill,
            backgroundColor: color.ink,
            opacity: allowDisabled ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <ThemedText variant="footnote" style={{ fontWeight: '600', color: color.bg }}>
            {verbs.yes}
          </ThemedText>
        </Pressable>
      </View>
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

function FileChip({ file, onRemove }: { file: DraftFile; onRemove: () => void }) {
  const { color, space, radius } = useTheme();
  const bad = Boolean(file.problem);
  return (
    <View
      testID="file-chip"
      accessibilityLabel={file.problem ?? `${file.fileName}, ${formatSize(file.sizeBytes)}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        height: 32,
        maxWidth: 220,
        paddingLeft: space.sm,
        paddingRight: space.xs,
        borderRadius: radius.pill,
        backgroundColor: bad ? color.badTint : color.fill,
      }}
    >
      {file.preview ? <Image source={{ uri: file.preview }} style={{ width: 20, height: 20, borderRadius: 4 }} /> : null}
      <ThemedText variant="caption1" tone={bad ? 'bad' : 'ink2'} numberOfLines={1} style={{ flexShrink: 1 }}>
        {file.problem ?? file.fileName}
      </ThemedText>
      {file.problem ? null : (
        <ThemedText variant="caption2" tone="ink3">
          {formatSize(file.sizeBytes)}
        </ThemedText>
      )}
      <Pressable
        testID={`remove-file-${file.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${file.fileName}`}
        onPress={onRemove}
        hitSlop={8}
        style={({ pressed }) => ({ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
      >
        <ThemedText variant="footnote" tone="ink3">
          ×
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** One chat: the history, the reply streaming in live, and a composer pinned above the keyboard. */
export function ChatScreen({
  row,
  conversation,
  online,
  onBack,
  onTalk,
  hello = null,
  pickers = expoPickers,
  onTakeControl,
  computerName = 'This computer',
  pending = [],
  sending = {},
  failed = {},
  onAnswer,
  now = Date.now(),
}: {
  row: ChatRow;
  conversation: Conversation;
  online: boolean;
  onBack: () => void;
  onTalk?: () => void;
  hello?: HelloAttachments | null;
  pickers?: AttachmentPickers;
  /** Opens Computers, the existing take-control route. */
  onTakeControl?: () => void;
  /** What the strip calls the computer: "This computer", never a hostname. */
  computerName?: string;
  pending?: readonly Approval[];
  sending?: Record<string, ApprovalDecision>;
  failed?: Record<string, string>;
  onAnswer?: (id: string, decision: ApprovalDecision) => void;
  now?: number;
}) {
  const { color, space, radius, layout, type } = useTheme();
  const insets = useSafeAreaInsets();
  const snapshot = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [nextFileId, setNextFileId] = useState(1);
  const historyLines = chatLines(snapshot);
  const live = snapshot.live;
  const working = Boolean(row.working || live);
  const strip = takeControlCopy({ room: row.room, working, live: Boolean(live), online });
  const stripDetail = takeControlDetail(snapshot.items, working);
  const asks = onAnswer ? threadApprovals(pending, row.key, now) : [];
  const openComputer = onTakeControl ?? (() => undefined);
  const lines: Line[] = [
    ...historyLines,
    ...asks.map((approval) => ({ kind: 'ask' as const, key: `ask:${approval.id}`, approval })),
  ];
  const status = live ? (live.text ? 'Typing…' : phaseLabel(live.phase)) : !online ? 'Reconnecting…' : row.room ? 'Room' : row.trunkName ? `With ${row.trunkName}` : '';
  const canAttach = online && canSendAttachments(hello);
  const policy = resolvedAttachmentPolicy(hello);
  const readyFiles = toChatAttachments(files).length;
  const canSend = online && !live && (draft.trim().length > 0 || readyFiles > 0);

  const addPicked = (picked: PickedFile | null) => {
    if (!picked) return;
    const id = `f${nextFileId}`;
    setNextFileId((n) => n + 1);
    setFiles((current) => [...current, readPickedFile(id, picked, 'file', policy)]);
  };

  const pick = async (kind: 'photo' | 'library' | 'file') => {
    setMenuOpen(false);
    setPickError(null);
    setPreparing((n) => n + 1);
    try {
      const picked = kind === 'photo' ? await pickers.takePhoto(policy) : kind === 'library' ? await pickers.pickPhoto(policy) : await pickers.pickFile(policy);
      addPicked(picked);
    } catch (error) {
      setPickError(attachFailure(error));
    } finally {
      setPreparing((n) => n - 1);
    }
  };

  const send = () => {
    if (!canSend) return;
    tapHaptic();
    const text = draft;
    const attached = files;
    setDraft('');
    setFiles([]);
    setMenuOpen(false);
    setPickError(null);
    void conversation.send(text, attached);
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
          if (line.kind === 'ask') {
            return (
              <ThreadApprovalCard
                approval={line.approval}
                sending={sending[line.approval.id]}
                failed={failed[line.approval.id]}
                onAnswer={onAnswer!}
              />
            );
          }
          const item = line.item;
          if (item.kind === 'user') return <Bubble mine text={item.text} testID={`msg-${item.key}`} />;
          if (item.kind === 'assistant') return <Bubble mine={false} text={item.text} testID={`msg-${item.key}`} />;
          if (item.kind === 'work') return <WorkLine item={item} />;
          if (item.kind === 'computer') {
            const latestComputer = [...snapshot.items].reverse().find((entry) => entry.kind === 'computer');
            return (
              <ComputerMessage
                item={item}
                computerName={computerName}
                working={working && latestComputer?.key === item.key}
                onOpen={openComputer}
              />
            );
          }
          return <Notice text={item.text} failed={item.kind === 'error'} testID={`msg-${item.key}`} />;
        }}
        contentContainerStyle={{ paddingHorizontal: layout.screenInset - space.xs, paddingVertical: space.md, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      />
    );
  } else if (!snapshot.loaded && !snapshot.error) {
    body = <Skeleton />;
  } else if (!snapshot.loaded) {
    body = online ? (
      <Empty testID="chat-error" title="Couldn’t load this chat" body={plainError(snapshot.error)} action={{ title: 'Try again', onPress: () => void conversation.load() }} />
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
          {onTalk ? (
            <Pressable
              testID="chat-talk"
              accessibilityRole="button"
              accessibilityLabel="Talk"
              onPress={onTalk}
              hitSlop={8}
              style={({ pressed }) => ({ minWidth: layout.rowMinHeight, minHeight: layout.rowMinHeight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs, opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText variant="headline" tone="accentInk">
                Talk
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
        {online ? null : (
          <View style={{ paddingHorizontal: layout.screenInset, paddingBottom: space.sm }}>
            <OfflineBanner testID="chat-offline" message="Reconnecting to your computer… This chat may be out of date." />
          </View>
        )}
      </View>
      {strip && onTakeControl ? (
        <TakeControlStrip computerName={computerName} state={strip.state} liveOn={strip.liveOn} detail={stripDetail} onTakeControl={onTakeControl} />
      ) : null}
      <View style={{ flex: 1 }}>{body}</View>
      <View style={{ paddingHorizontal: layout.screenInset - space.xs, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm, borderTopWidth: layout.hairline, borderTopColor: color.line, backgroundColor: color.bg, gap: space.sm }}>
        {files.length || preparing ? (
          <ScrollView horizontal testID="file-chips" contentContainerStyle={{ gap: space.xs, alignItems: 'center' }}>
            {preparing ? (
              <ThemedText testID="preparing-attachments" variant="caption1" tone="ink3">
                {preparingLine(preparing)}
              </ThemedText>
            ) : null}
            {files.map((file) => (
              <FileChip key={file.id} file={file} onRemove={() => setFiles((current) => current.filter((f) => f.id !== file.id))} />
            ))}
          </ScrollView>
        ) : null}
        {online && !canSendAttachments(hello) ? (
          <ThemedText testID="attach-unavailable" variant="caption1" tone="ink3">
            {NO_ATTACH_METHOD_NOTE}
          </ThemedText>
        ) : null}
        {pickError ? (
          <ThemedText testID="attach-error" variant="caption1" tone="bad">
            {pickError}
          </ThemedText>
        ) : null}
        {menuOpen ? (
          <View testID="attach-menu" style={{ backgroundColor: color.raise, borderRadius: radius.md, overflow: 'hidden' }}>
            {(
              [
                ['attach-photo', 'Take photo', 'photo'],
                ['attach-library', 'Photo library', 'library'],
                ['attach-file', 'File', 'file'],
              ] as const
            ).map(([testID, title, kind]) => (
              <Pressable
                key={testID}
                testID={testID}
                accessibilityRole="button"
                accessibilityLabel={title}
                onPress={() => void pick(kind)}
                style={({ pressed }) => ({ minHeight: layout.rowMinHeight, justifyContent: 'center', paddingHorizontal: space.md, backgroundColor: pressed ? color.fill : 'transparent' })}
              >
                <ThemedText variant="body">{title}</ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <Pressable
          testID="attach"
          accessibilityRole="button"
          accessibilityLabel="Attach a photo or file"
          accessibilityHint={canAttach ? undefined : NO_ATTACH_METHOD_NOTE}
          accessibilityState={{ disabled: !canAttach }}
          disabled={!canAttach}
          onPress={() => setMenuOpen((open) => !open)}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: radius.pill,
            backgroundColor: color.fill,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !canAttach ? 0.4 : pressed ? 0.7 : 1,
          })}
        >
          <ThemedText variant="title3" tone="accentInk" style={{ fontWeight: '400' }}>
            +
          </ThemedText>
        </Pressable>
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
      </View>
    </KeyboardAvoidingView>
  );
}
