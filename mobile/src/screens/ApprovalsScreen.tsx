import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
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
import { LIST_FAILED_MESSAGE, RECONNECT_WAIT_MS, trunkOf, type Answered, type Approval, type ApprovalDecision, type ApprovalsSnapshot, type Trunk } from '../approvals/approvals';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';

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
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: color.accentTint, alignItems: 'center', justifyContent: 'center' }}>
      <ThemedText variant={size >= 36 ? 'headline' : 'subhead'} tone="accentInk">
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
          <ThemedText variant="footnote" tone="accentInk">
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
        borderColor: color.accent,
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
          <Button title={`Always allow for ${trunk.name}`} kind="secondary" busy={sending === 'allow-always'} disabled={busy} onPress={() => onAnswer(approval.id, 'allow-always')} testID={`always-${approval.id}`} />
          <Button title="Cancel" kind="plain" disabled={busy} onPress={() => setAskAlways(false)} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <View style={{ flex: 1 }}>
              <Button title={verbs.no} kind="secondary" busy={sending === 'deny'} disabled={busy} onPress={() => onAnswer(approval.id, 'deny')} testID={`deny-${approval.id}`} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={verbs.yes} busy={sending === 'allow-once'} disabled={busy} onPress={() => onAnswer(approval.id, 'allow-once')} testID={`allow-${approval.id}`} />
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
              <ThemedText variant="subhead" tone="accentInk">
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
          <ThemedText variant="subhead" tone="accentInk">
            Look at the chat first ›
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function AnsweredRow({ answered, trunk }: { answered: Answered; trunk: Trunk }) {
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
    <View testID="notifications-card" style={{ backgroundColor: color.accentTint, borderRadius: radius.lg, padding: layout.cardInset, marginTop: space.md, gap: space.sm }}>
      <ThemedText variant="headline">{off ? 'Notifications are off for Branch' : 'Get approvals as notifications'}</ThemedText>
      <ThemedText variant="subhead" tone="ink2">
        {off
          ? 'Turn them on in Settings to answer approvals from the lock screen.'
          : 'Answer with Allow or Deny right on the notification while Branch is in the background.'}
      </ThemedText>
      <Button title={off ? 'Open Settings' : 'Turn on notifications'} kind="primary" onPress={off ? onSettings : onTurnOn} testID={off ? 'notifications-settings' : 'notifications-turn-on'} />
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
          <Button title={action.title} kind="secondary" onPress={action.onPress} testID={`${testID}-action`} />
        </View>
      ) : null}
    </View>
  );
}

/** Needs you: every approval waiting on the computer, answered right here, and what was answered lately. */
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
  now: fixedNow,
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
  now?: number;
}) {
  const { color, space, radius, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow(fixedNow, snapshot.pending.some((a) => a.expiresAtMs));
  const pending = focusId ? [...snapshot.pending].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)) : snapshot.pending;
  const waiting = snapshot.pending.filter((a) => !isExpired(a, now)).length;

  let body;
  if (!snapshot.loaded && !snapshot.error) body = <Note testID="approvals-loading" title="Checking with your computer…" body="Anything a Trunk is waiting on shows up here." />;
  else if (!snapshot.loaded)
    body = online ? (
      // snapshot.error is already plain words (approvals.ts listFailureMessage); the fallback covers a blank one.
      <Note testID="approvals-error" title="Couldn’t check for approvals" body={snapshot.error || LIST_FAILED_MESSAGE} action={{ title: 'Try again', onPress: onRetry }} />
    ) : (
      <Note testID="approvals-waiting" title="Waiting for your computer" body="Approvals show up here as soon as this phone reaches it." />
    );
  else if (pending.length === 0) body = <Note testID="approvals-empty" title="Nothing is waiting for you" body="Trunks show up here when they need a yes." />;
  else
    body = pending.map((approval) => (
      <ApprovalCard
        key={approval.id}
        approval={approval}
        trunk={trunkOf(approval, snapshot.trunks)}
        now={now}
        sending={snapshot.sending[approval.id]}
        failed={snapshot.failed[approval.id]}
        focused={approval.id === focusId && pending.length > 1}
        onAnswer={onAnswer}
        onOpenChat={onOpenChat && approval.sessionKey && canOpenChat(approval.sessionKey) ? () => onOpenChat(approval.sessionKey!) : undefined}
      />
    ));

  return (
    <View testID="approvals-screen" style={{ flex: 1, backgroundColor: color.grouped }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.xs, paddingHorizontal: layout.screenInset, paddingBottom: insets.bottom + space.xl }}>
        <Pressable
          testID="approvals-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Chats"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <ThemedText variant="body" tone="accentInk">
            ‹ Chats
          </ThemedText>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <ThemedText variant="largeTitle" accessibilityRole="header">
            Needs you
          </ThemedText>
          {waiting ? (
            <View
              testID="approvals-count"
              accessibilityLabel={`${waiting} waiting`}
              style={{ minWidth: 24, height: 24, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <ThemedText variant="footnote" tone="onAccent" style={{ fontWeight: '700' }}>
                {waiting}
              </ThemedText>
            </View>
          ) : null}
        </View>
        {online ? null : (
          <View testID="approvals-offline" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, backgroundColor: color.warnTint, borderRadius: radius.md, padding: space.md }}>
            <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.warn }} />
            <ThemedText variant="footnote" tone="ink2" style={{ flex: 1 }}>
              {/* answer() waits RECONNECT_WAIT_MS for the computer, then gives up with "Try again when it’s back". */}
              {`Reconnecting to your computer… An answer sent now waits up to ${Math.round(RECONNECT_WAIT_MS / 1000)} seconds for it, then asks you to try again.`}
            </ThemedText>
          </View>
        )}
        <PermissionCard permission={permission} onTurnOn={onTurnOnNotifications} onSettings={onOpenSettings} />
        {body}
        {snapshot.answered.length ? (
          <View testID="approvals-answered" style={{ marginTop: space.xxl }}>
            <ThemedText variant="footnote" tone="ink3" accessibilityRole="header" style={{ fontWeight: '600', textTransform: 'uppercase', marginBottom: space.xs }}>
              Answered
            </ThemedText>
            <View style={{ backgroundColor: color.raise, borderRadius: radius.lg, paddingHorizontal: layout.cardInset, paddingVertical: space.xs }}>
              {snapshot.answered.map((answered) => (
                <AnsweredRow key={answered.id} answered={answered} trunk={trunkOf(answered, snapshot.trunks)} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
