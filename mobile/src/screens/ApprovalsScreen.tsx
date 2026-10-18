import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NotificationPermission } from '../approvals/approvalAlerts';
import {
  actionFields,
  actionWords,
  alwaysAllowCover,
  computerName,
  expiresIn,
  headline,
  isExpired,
  maskCommand,
  mixedAlphabets,
  outcomeWords,
  shortFolder,
} from '../approvals/approvalWords';
import { TEST_APPROVAL_DELAY_MS, TEST_APPROVAL_PLUGIN } from '../approvals/testApproval';
import type { TestApprovalState } from '../approvals/useTestApproval';
import { LIST_FAILED_MESSAGE, RECONNECT_WAIT_MS, trunkOf, type Answered, type Approval, type ApprovalDecision, type ApprovalsSnapshot, type Trunk } from '../approvals/approvals';
import { groupByTrunk, INBOX_TABS, type InboxTab } from '../approvals/inboxGroups';
import { chatTime } from '../chats/chatTime';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { FadeScrollView as ScrollView } from '../ui/ScrollFade';
import { LIST_FADE } from '../ui/scrollEdges';
import { OfflineBanner } from '../ui/OfflineBanner';
import { PlacesBar, placesBarHeight, type PhoneLook, type Place } from '../ui/PlacesBar';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const LONG_COMMAND = 160;
const SOON_MS = 2 * 60_000;

/** The time, ticking each second while something can expire; a fixed time in tests and screenshots. */
function useNow(fixed: number | undefined, ticking: boolean): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined || !ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fixed, ticking]);
  return fixed ?? now;
}

function TrunkAvatar({ trunk, size = 36 }: { trunk: Trunk; size?: number }) {
  const { color, radius } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' }}>
      <ThemedText variant={size >= 36 ? 'headline' : 'subhead'} tone="ink">
        {trunk.avatar}
      </ThemedText>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.xxs }}>
      <ThemedText variant="subhead" tone="ink3" style={{ width: 76 }}>
        {label}
      </ThemedText>
      <ThemedText variant="subhead" tone="ink2" style={{ flex: 1 }}>
        {value}
      </ThemedText>
    </View>
  );
}

/** What the Trunk would do: the command itself, secrets dotted out, or a plugin's rows and words. */
function WhatItDoes({ approval }: { approval: Approval }) {
  const { color, space, radius } = useTheme();
  const [all, setAll] = useState(false);
  if (approval.kind === 'plugin') {
    const { fields, body } = actionFields(approval.description ?? '');
    return (
      <View style={{ marginTop: space.sm }}>
        {fields.map(([k, v]) => (
          <Detail key={k} label={k} value={v} />
        ))}
        {body ? (
          <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }} numberOfLines={all ? undefined : 4}>
            {body}
          </ThemedText>
        ) : null}
      </View>
    );
  }
  const command = maskCommand(approval.command);
  const long = command.length > LONG_COMMAND;
  return (
    <View style={{ marginTop: space.sm }}>
      <View testID={`command-${approval.id}`} style={{ backgroundColor: color.fill, borderRadius: radius.sm, padding: space.md }}>
        <ThemedText variant="subhead" selectable numberOfLines={all || !long ? undefined : 4} style={{ fontFamily: MONO }}>
          {command}
        </ThemedText>
      </View>
      {long ? (
        <Pressable accessibilityRole="button" onPress={() => setAll((v) => !v)} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
          <ThemedText variant="footnote" tone="ink">
            {all ? 'Show less' : 'Show the whole command'}
          </ThemedText>
        </Pressable>
      ) : null}
      <View style={{ marginTop: space.sm }}>
        <Detail label="Computer" value={computerName(approval.host)} />
        <Detail label="Folder" value={approval.cwd ? shortFolder(approval.cwd) : 'Its workspace'} />
      </View>
    </View>
  );
}

function Notice({ text, tone, testID }: { text: string; tone: 'warn' | 'bad'; testID?: string }) {
  const { color, space, radius } = useTheme();
  return (
    <View testID={testID} style={{ marginTop: space.sm, backgroundColor: tone === 'warn' ? color.warnTint : color.badTint, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm }}>
      <ThemedText variant="footnote" tone="ink">
        {text}
      </ThemedText>
    </View>
  );
}

function ApprovalCard({
  approval,
  trunk,
  now,
  sending,
  failed,
  focused,
  onAnswer,
  onOpenChat,
}: {
  approval: Approval;
  trunk: Trunk;
  now: number;
  sending?: ApprovalDecision;
  failed?: string;
  focused: boolean;
  onAnswer: (id: string, decision: ApprovalDecision) => void;
  onOpenChat?: () => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const [askAlways, setAskAlways] = useState(false);
  const verbs = actionWords(approval);
  const expired = isExpired(approval, now);
  const left = expiresIn(approval.expiresAtMs, now);
  const soon = Boolean(approval.expiresAtMs && approval.expiresAtMs - now < SOON_MS);
  const always = approval.kind === 'exec' && approval.allowedDecisions.includes('allow-always');
  const busy = Boolean(sending);
  return (
    <View
      testID={`approval-${approval.id}`}
      accessibilityLabel={`${trunk.name} needs a yes: ${headline(approval)}`}
      style={{
        backgroundColor: color.raise,
        borderRadius: radius.lg,
        padding: layout.cardInset,
        marginTop: space.md,
        borderWidth: focused ? 2 : 0,
        borderColor: color.ink,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <TrunkAvatar trunk={trunk} size={32} />
        <ThemedText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
          {trunk.name}
        </ThemedText>
        {left ? (
          <ThemedText testID={`expires-${approval.id}`} variant="footnote" tone={soon ? 'warn' : 'ink3'}>
            {left}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText variant="title3" style={{ marginTop: space.sm }}>
        {headline(approval)}
      </ThemedText>
      <WhatItDoes approval={approval} />
      {approval.warnings.map((w, i) => (
        <Notice key={i} tone="warn" text={`Noticed: ${w}`} />
      ))}
      {approval.kind === 'exec' && mixedAlphabets(approval.command) ? (
        <Notice testID={`mixed-${approval.id}`} tone="warn" text="This command mixes letters from different alphabets that can look the same. Read it carefully." />
      ) : null}
      {failed ? <Notice testID={`failed-${approval.id}`} tone="bad" text={failed} /> : null}
      {expired ? (
        <ThemedText testID={`expired-${approval.id}`} variant="subhead" tone="ink2" style={{ marginTop: space.md }}>
          {`This request ran out of time, so nothing ran. ${trunk.name} can ask again.`}
        </ThemedText>
      ) : askAlways ? (
        <View testID={`always-confirm-${approval.id}`} style={{ marginTop: space.md, gap: space.sm }}>
          <ThemedText variant="subhead" tone="ink2">
            {alwaysAllowCover(trunk.name)}
          </ThemedText>
          <Button title={`Always allow for ${trunk.name}`} kind="ink" busy={sending === 'allow-always'} disabled={busy} onPress={() => onAnswer(approval.id, 'allow-always')} testID={`always-${approval.id}`} />
          <Button title="Cancel" kind="inkSecondary" disabled={busy} onPress={() => setAskAlways(false)} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <View style={{ flex: 1 }}>
              <Button title={verbs.yes} kind="ink" busy={sending === 'allow-once'} disabled={busy} onPress={() => onAnswer(approval.id, 'allow-once')} testID={`allow-${approval.id}`} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={verbs.no} kind="inkSecondary" busy={sending === 'deny'} disabled={busy} onPress={() => onAnswer(approval.id, 'deny')} testID={`deny-${approval.id}`} />
            </View>
          </View>
          {always ? (
            <Pressable
              testID={`always-ask-${approval.id}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setAskAlways(true)}
              style={({ pressed }) => ({ alignSelf: 'center', minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText variant="subhead" tone="ink">
                {`Always allow for ${trunk.name}…`}
              </ThemedText>
            </Pressable>
          ) : null}
        </>
      )}
      {onOpenChat ? (
        <Pressable
          testID={`open-chat-${approval.id}`}
          accessibilityRole="button"
          onPress={onOpenChat}
          style={({ pressed }) => ({ marginTop: always && !expired && !askAlways ? 0 : space.sm, borderTopWidth: layout.hairline, borderTopColor: color.line, minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <ThemedText variant="subhead" tone="ink">
            Look at the chat first ›
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function InboxTabs({ tab, needs, onChange }: { tab: InboxTab; needs: number; onChange: (tab: InboxTab) => void }) {
  const { color, space, radius, layout } = useTheme();
  return (
    <View testID="inbox-tabs" accessibilityRole="tablist" style={{ flexDirection: 'row', gap: space.xxs, padding: space.xxs + 1, marginTop: space.md, borderRadius: radius.md, backgroundColor: color.fill }}>
      {INBOX_TABS.map(({ id, label }) => {
        const on = tab === id;
        const title = id === 'needs' && needs ? `${label} · ${needs}` : label;
        return (
          <Pressable
            key={id}
            testID={`inbox-tab-${id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={title}
            onPress={() => onChange(id)}
            style={{
              flex: 1,
              minHeight: layout.rowMinHeight,
              paddingHorizontal: space.xs,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? color.raise : 'transparent',
            }}
          >
            <ThemedText variant="caption1" tone={on ? 'ink' : 'ink2'} style={{ fontWeight: on ? '600' : '400' }} numberOfLines={1}>
              {title}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function TrunkGroup({ trunk, count, groupKey, children }: { trunk: Trunk; count: number; groupKey: string; children: ReactNode }) {
  const { color, space, radius } = useTheme();
  return (
    <View testID={`inbox-group-${groupKey}`} style={{ marginTop: space.md }}>
      <View testID={`inbox-group-head-${groupKey}`} accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
        <TrunkAvatar trunk={trunk} size={26} />
        <ThemedText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
          {trunk.name}
        </ThemedText>
        {count ? (
          <View style={{ minWidth: 20, height: 20, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' }}>
            <ThemedText variant="caption2" tone="ink2" style={{ fontWeight: '600' }}>
              {count}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function HistoryRow({ answered, trunk, now }: { answered: Answered; trunk: Trunk; now: number }) {
  const { space } = useTheme();
  return (
    <View testID={`history-${answered.id}`} style={{ paddingVertical: space.sm, gap: space.xxs }}>
      <ThemedText variant="caption1" tone="ink3">
        {chatTime(answered.at, now)}
      </ThemedText>
      <ThemedText variant="subhead">
        {`${trunk.name} · ${headline(answered)}`}
      </ThemedText>
      <ThemedText variant="footnote" tone="ink2">
        {outcomeWords(answered)}
      </ThemedText>
    </View>
  );
}

function AnsweredRow({ answered, trunk, onOpen }: { answered: Answered; trunk: Trunk; onOpen?: () => void }) {
  const { color, space, radius } = useTheme();
  const fill = answered.outcome === 'allowed' ? color.okTint : answered.outcome === 'denied' ? color.badTint : color.fill;
  return (
    <View testID={`answered-${answered.id}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm + 2 }}>
      <TrunkAvatar trunk={trunk} size={28} />
      <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
        <ThemedText variant="subhead" numberOfLines={2}>
          {`${trunk.name} · ${headline(answered)}`}
        </ThemedText>
        {answered.kind === 'exec' ? (
          <ThemedText variant="footnote" tone="ink3" numberOfLines={1} style={{ fontFamily: MONO }}>
            {maskCommand(answered.command)}
          </ThemedText>
        ) : null}
        <View style={{ alignSelf: 'flex-start', backgroundColor: fill, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs, marginTop: space.xxs }}>
          <ThemedText variant="caption1" tone="ink">
            {outcomeWords(answered)}
          </ThemedText>
        </View>
        {onOpen ? (
          <Pressable
            testID={`open-finished-${answered.id}`}
            accessibilityRole="button"
            onPress={onOpen}
            hitSlop={8}
            style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText variant="subhead" tone="ink">
              Open
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function PermissionCard({ permission, onTurnOn, onSettings }: { permission: NotificationPermission | null; onTurnOn: () => void; onSettings: () => void }) {
  const { color, space, radius, layout } = useTheme();
  if (permission === 'unavailable') {
    // Expo Go on Android and the web preview can't post Branch's notifications; answering here still works.
    return (
      <ThemedText testID="notifications-unavailable" variant="footnote" tone="ink2" style={{ marginTop: space.md }}>
        Notifications need the installed Branch app. Approvals still show up here.
      </ThemedText>
    );
  }
  if (permission !== 'undetermined' && permission !== 'denied') return null;
  const off = permission === 'denied';
  return (
    <View testID="notifications-card" style={{ backgroundColor: color.fill, borderRadius: radius.lg, padding: layout.cardInset, marginTop: space.md, gap: space.sm }}>
      <ThemedText variant="headline">{off ? 'Notifications are off for Branch' : 'Get approvals as notifications'}</ThemedText>
      <ThemedText variant="subhead" tone="ink2">
        {off
          ? 'Turn them on in Settings to answer approvals from the lock screen.'
          : 'Answer with Allow or Deny right on the notification while Branch is in the background.'}
      </ThemedText>
      <Button title={off ? 'Open Settings' : 'Turn on notifications'} kind="ink" onPress={off ? onSettings : onTurnOn} testID={off ? 'notifications-settings' : 'notifications-turn-on'} />
    </View>
  );
}

function Note({ title, body, testID, action }: { title: string; body: string; testID: string; action?: { title: string; onPress: () => void } }) {
  const { space } = useTheme();
  return (
    <View testID={testID} style={{ paddingTop: space.xxxl * 1.5, paddingHorizontal: space.lg, alignItems: 'center', gap: space.sm }}>
      <ThemedText variant="title3" style={{ textAlign: 'center' }}>
        {title}
      </ThemedText>
      <ThemedText variant="subhead" tone="ink2" style={{ textAlign: 'center' }}>
        {body}
      </ThemedText>
      {action ? (
        <View style={{ marginTop: space.md, alignSelf: 'stretch' }}>
          <Button title={action.title} kind="inkSecondary" onPress={action.onPress} testID={`${testID}-action`} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * For testing (a development build, or one built with EXPO_PUBLIC_BRANCH_TEST_APPROVALS=1): asks the computer for a
 * test approval that runs nothing, now or in ten seconds so the phone can be locked to see the notification.
 */
function TestApprovalCard({ state, waiting, onSend, onCancel }: { state: TestApprovalState; waiting: boolean; onSend: (delayMs: number) => void; onCancel: () => void }) {
  const { color, space, radius, layout } = useTheme();
  const counting = state.phase === 'counting';
  // Redraws four times a second while counting; the seconds are read from the clock each time.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!counting) return;
    const tick = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(tick);
  }, [counting]);
  const secs = counting ? Math.max(1, Math.ceil((state.at - Date.now()) / 1000)) : 0;
  return (
    <View testID="test-approval-card" style={{ marginTop: space.xxl }}>
      <ThemedText variant="footnote" tone="ink3" accessibilityRole="header" style={{ fontWeight: '600', textTransform: 'uppercase', marginBottom: space.xs }}>
        For testing
      </ThemedText>
      <View style={{ backgroundColor: color.raise, borderRadius: radius.lg, padding: layout.cardInset, gap: space.sm }}>
        <ThemedText variant="headline">Check that approvals work</ThemedText>
        <ThemedText variant="subhead" tone="ink2">
          Sends a test approval from this phone. Nothing runs, whatever you choose. It shows up here and in Branch on your computer, and either can answer it.
        </ThemedText>
        {counting ? (
          <>
            <ThemedText testID="test-approval-countdown" variant="subhead" tone="ink">
              {`Sending in ${secs} s. Lock the phone now: the notification should arrive with Allow and Deny.`}
            </ThemedText>
            <Button title="Cancel" kind="plain" onPress={onCancel} testID="test-approval-cancel" />
          </>
        ) : (
          <>
            <Button title="Send a test approval" kind="inkSecondary" busy={state.phase === 'sending'} disabled={state.phase === 'sending'} onPress={() => onSend(0)} testID="test-approval-send" />
            <Button
              title={`Send one in ${Math.round(TEST_APPROVAL_DELAY_MS / 1000)} seconds`}
              kind="plain"
              disabled={state.phase === 'sending'}
              onPress={() => onSend(TEST_APPROVAL_DELAY_MS)}
              testID="test-approval-later"
            />
          </>
        )}
        {state.phase === 'sent' && waiting ? (
          <ThemedText testID="test-approval-sent" variant="footnote" tone="ink2">
            Sent. Answer it above, or on your computer.
          </ThemedText>
        ) : null}
        {state.phase === 'failed' ? <Notice testID="test-approval-failed" tone="bad" text={state.message} /> : null}
      </View>
    </View>
  );
}

/** Inbox: Needs you grouped by Trunk, then Finished, then History. Approvals still answer here. */
export function ApprovalsScreen({
  snapshot,
  online,
  permission,
  onTurnOnNotifications,
  onOpenSettings,
  onAnswer,
  onRetry,
  onBack,
  onOpenChat,
  canOpenChat = () => false,
  focusId,
  test,
  now: fixedNow,
  bottomExtra = 0,
  initialTab = 'needs',
  onPlace,
  look = Platform.OS === 'ios' ? 'ios' : 'android',
}: {
  snapshot: ApprovalsSnapshot;
  online: boolean;
  permission: NotificationPermission | null;
  onTurnOnNotifications: () => void;
  onOpenSettings: () => void;
  onAnswer: (id: string, decision: ApprovalDecision) => void;
  /** Reads the list again after a read failed. */
  onRetry: () => void;
  onBack: () => void;
  onOpenChat?: (sessionKey: string) => void;
  canOpenChat?: (sessionKey: string) => boolean;
  /** The approval a notification was tapped for: it comes first and is outlined. */
  focusId?: string;
  /** The test approval tools, in builds that have them (testApproval.ts testApprovalsOn). */
  test?: { state: TestApprovalState; onSend: (delayMs: number) => void; onCancel: () => void };
  now?: number;
  /** Extra padding above a floating Places bar. */
  bottomExtra?: number;
  /** Starts on this tab (screenshots and tests). Taps still switch. */
  initialTab?: InboxTab;
  /** Root-place nav, same PlacesBar Home and Chats use. Absent in nested screenshot mounts. */
  onPlace?: (place: Place) => void;
  look?: PhoneLook;
}) {
  const { color, space, radius, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const ios = look === 'ios';
  const tabPad = onPlace ? placesBarHeight(look, insets.bottom) : 0;
  const now = useNow(fixedNow, snapshot.pending.some((a) => a.expiresAtMs));
  const [tab, setTab] = useState<InboxTab>(initialTab);
  const pending = focusId ? [...snapshot.pending].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)) : snapshot.pending;
  const waiting = snapshot.pending.filter((a) => !isExpired(a, now)).length;
  const groups = groupByTrunk(pending, snapshot.trunks, focusId);
  const finished = groupByTrunk(snapshot.answered, snapshot.trunks);

  let needsBody;
  if (!snapshot.loaded && !snapshot.error) needsBody = <Note testID="approvals-loading" title="Checking with your computer…" body="Anything a Trunk is waiting on shows up here." />;
  else if (!snapshot.loaded)
    needsBody = online ? (
      // snapshot.error is already plain words (approvals.ts listFailureMessage); the fallback covers a blank one.
      <Note testID="approvals-error" title="Couldn’t check for approvals" body={snapshot.error || LIST_FAILED_MESSAGE} action={{ title: 'Try again', onPress: onRetry }} />
    ) : (
      <Note testID="approvals-waiting" title="Waiting for your computer" body="Approvals show up here as soon as this phone reaches it." />
    );
  else if (pending.length === 0) needsBody = <Note testID="approvals-empty" title="Nothing is waiting for you" body="Trunks show up here when they need a yes." />;
  else
    needsBody = groups.map((group) => (
      <TrunkGroup key={group.key} groupKey={group.key} trunk={group.trunk} count={group.items.length}>
        {group.items.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            trunk={group.trunk}
            now={now}
            sending={snapshot.sending[approval.id]}
            failed={snapshot.failed[approval.id]}
            focused={approval.id === focusId && pending.length > 1}
            onAnswer={onAnswer}
            onOpenChat={onOpenChat && approval.sessionKey && canOpenChat(approval.sessionKey) ? () => onOpenChat(approval.sessionKey!) : undefined}
          />
        ))}
      </TrunkGroup>
    ));

  const finishedBody = snapshot.answered.length ? (
    <View testID="inbox-finished">
      {finished.map((group) => (
        <TrunkGroup key={group.key} groupKey={`finished-${group.key}`} trunk={group.trunk} count={group.items.length}>
          <View style={{ backgroundColor: color.raise, borderRadius: radius.lg, paddingHorizontal: layout.cardInset, paddingVertical: space.xs }}>
            {group.items.map((answered) => (
              <AnsweredRow
                key={answered.id}
                answered={answered}
                trunk={group.trunk}
                onOpen={onOpenChat && answered.sessionKey && canOpenChat(answered.sessionKey) ? () => onOpenChat(answered.sessionKey!) : undefined}
              />
            ))}
          </View>
        </TrunkGroup>
      ))}
    </View>
  ) : (
    <Note testID="inbox-finished-empty" title="Nothing finished yet." body="Answered requests show up here." />
  );

  const historyBody = snapshot.answered.length ? (
    <View testID="inbox-history" style={{ marginTop: space.md }}>
      {snapshot.answered.map((answered) => (
        <HistoryRow key={answered.id} answered={answered} trunk={trunkOf(answered, snapshot.trunks)} now={now} />
      ))}
    </View>
  ) : (
    <Note testID="inbox-history-empty" title="Nothing in History yet." body="A record of what you answered shows up here." />
  );

  return (
    <View testID="approvals-screen" style={{ flex: 1, backgroundColor: color.grouped }}>
      <ScrollView
        testID="inbox-scroll"
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.xs,
          paddingHorizontal: layout.screenInset,
          paddingBottom: (onPlace ? (ios ? tabPad : 0) : insets.bottom) + space.xl + (onPlace ? 0 : bottomExtra) + LIST_FADE,
        }}
      >
        <Pressable
          testID="approvals-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Chats"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <ThemedText variant="body" tone="ink">
            ‹ Chats
          </ThemedText>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <ThemedText variant="largeTitle" accessibilityRole="header">
            Inbox
          </ThemedText>
          {waiting ? (
            <View
              testID="approvals-count"
              accessibilityLabel={`${waiting} waiting`}
              style={{ minWidth: 24, height: 24, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}
            >
              <ThemedText variant="footnote" style={{ fontWeight: '700', color: color.bg }}>
                {waiting}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          Everything a Trunk is waiting on you for, what finished, and a record of what ran.
        </ThemedText>
        <InboxTabs tab={tab} needs={waiting} onChange={setTab} />
        {online ? null : (
          // answer() waits RECONNECT_WAIT_MS for the computer, then gives up with "Try again when it’s back".
          <OfflineBanner
            testID="approvals-offline"
            message={`Reconnecting to your computer… An answer sent now waits up to ${Math.round(RECONNECT_WAIT_MS / 1000)} seconds for it, then asks you to try again.`}
          />
        )}
        {tab === 'needs' ? (
          <>
            <PermissionCard permission={permission} onTurnOn={onTurnOnNotifications} onSettings={onOpenSettings} />
            {needsBody}
            {test ? (
              <TestApprovalCard state={test.state} waiting={snapshot.pending.some((a) => a.pluginId === TEST_APPROVAL_PLUGIN)} onSend={test.onSend} onCancel={test.onCancel} />
            ) : null}
          </>
        ) : null}
        {tab === 'finished' ? finishedBody : null}
        {tab === 'history' ? historyBody : null}
      </ScrollView>
      {onPlace ? <PlacesBar current="inbox" inboxCount={snapshot.pending.length} onPlace={onPlace} look={look} /> : null}
    </View>
  );
}
