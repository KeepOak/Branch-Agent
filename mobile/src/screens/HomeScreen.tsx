import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApprovalDecision, ApprovalsSnapshot } from '../approvals/approvals';
import type { ChatListSnapshot, ChatRow } from '../chats/chatList';
import { chatTime } from '../chats/chatTime';
import {
  finishedNow,
  gatewayWord,
  greet,
  homeNeeds,
  homeSummary,
  isAdvanced,
  laterUpdate,
  workingNow,
  workingStep,
  type AccessLevel,
  type LaterHomeAction,
} from '../home/homeModel';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { OfflineBanner } from '../ui/OfflineBanner';
import { PlacesBar, type Place } from '../ui/PlacesBar';
import { useNow } from '../ui/useNow';
import { Avatar } from './ChatsScreen';

const QUICK_WORKING = [
  ['new-chat', 'New chat'],
  ['computer', 'Computer'],
] as const;

const QUICK_LATER: Array<[string, LaterHomeAction]> = [
  ['talk', 'Talk'],
  ['new-trunk', 'New Trunk'],
  ['scan', 'Scan'],
  ['automations', 'Automations'],
];

function Section({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  const { color, space, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg, marginBottom: space.sm }}>
      <ThemedText variant="footnote" tone="ink2" style={{ fontWeight: '600' }}>
        {title}
      </ThemedText>
      {count ? (
        <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText variant="caption2" style={{ color: color.bg, fontWeight: '700' }}>
            {count}
          </ThemedText>
        </View>
      ) : null}
      {action ? <View style={{ marginLeft: 'auto' }}>{action}</View> : null}
    </View>
  );
}

function HomeCard({ children, testID }: { children: ReactNode; testID?: string }) {
  const { color, space, radius } = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: color.fill, borderRadius: 24, padding: space.md, marginBottom: space.sm }}>
      {children}
    </View>
  );
}

function Calm({ text, testID }: { text: string; testID: string }) {
  return (
    <HomeCard testID={testID}>
      <ThemedText variant="subhead" tone="ink2">
        {text}
      </ThemedText>
    </HomeCard>
  );
}

function Chip({ title, onPress, kind = 'quiet', testID, disabled }: { title: string; onPress: () => void; kind?: 'ink' | 'quiet'; testID: string; disabled?: boolean }) {
  const { color, space, radius, layout } = useTheme();
  const ink = kind === 'ink';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: ink ? color.ink : color.raise,
        justifyContent: 'center',
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <ThemedText variant="footnote" style={{ color: ink ? color.bg : color.ink, fontWeight: '600' }}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

/**
 * The paired Home from preview r50: greeting, one-line summary, Needs you (Allow or Send, Deny,
 * Look first), Working now with a step bar and a live still, What’s left, quick actions, Finished,
 * and Branch on your computer. Unfinished destinations stay off Regular; at Advanced they say
 * "<label> comes in a later update."
 */
export function HomeScreen({
  chats,
  approvals,
  online,
  accessLevel = 'regular',
  onNewChat,
  onComputer,
  onAnswer,
  onLookFirst,
  onPlace,
  onOpenChat,
  now: fixedNow,
  updateBanner,
}: {
  chats: ChatListSnapshot;
  approvals: ApprovalsSnapshot;
  online: boolean;
  accessLevel?: AccessLevel;
  onNewChat: () => void;
  onComputer: () => void;
  onAnswer: (id: string, decision: ApprovalDecision) => void;
  onLookFirst: (id: string, sessionKey?: string) => void;
  onPlace: (place: Place) => void;
  onOpenChat?: (row: ChatRow) => void;
  now?: number;
  updateBanner?: ReactNode;
}) {
  const { color, space, layout } = useTheme();
  const insets = useSafeAreaInsets();
  useNow(30_000);
  const now = fixedNow ?? Date.now();
  const advanced = isAdvanced(accessLevel);
  const needs = homeNeeds(approvals.pending, approvals.trunks);
  const working = workingNow(chats.rows);
  const finished = finishedNow(chats.rows, now);
  const waiting = approvals.pending.length;
  const [later, setLater] = useState<string | null>(null);

  const showLater = (label: LaterHomeAction) => {
    if (!advanced) return;
    setLater(laterUpdate(label));
  };

  const quick = [
    ...QUICK_WORKING.map(([id, label]) => ({ id, label, later: false as const })),
    ...(advanced ? QUICK_LATER.map(([id, label]) => ({ id, label, later: true as const })) : []),
  ];

  return (
    <View testID="home-screen" style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView
        testID="home-scroll"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: layout.screenInset, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginBottom: space.sm }}>
          <ThemedText testID="home-greeting" variant="title2" accessibilityRole="header">
            {greet(now)}
          </ThemedText>
          <View
            testID="home-you"
            accessibilityRole="image"
            accessibilityLabel="You"
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}
          >
            <ThemedText variant="footnote" style={{ color: color.bg, fontWeight: '600' }}>
              You
            </ThemedText>
          </View>
        </View>

        {updateBanner}

        <ThemedText testID="home-summary" variant="footnote" tone="ink3" style={{ marginBottom: space.sm }}>
          {homeSummary(waiting, working.length)}
        </ThemedText>

        {online ? null : <OfflineBanner testID="home-offline" message="Reconnecting to your computer… Home may be out of date." />}

        <Section title="Needs you" count={waiting || undefined} />
        {needs.length ? (
          needs.map((need) => (
            <HomeCard key={need.id} testID={`home-need-${need.id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
                <Avatar row={{ key: need.id, title: need.trunk.name, avatar: need.trunk.avatar, preview: '', updatedAt: 0, working: false, unread: false, pinned: false, needsYou: false, room: false, archived: false, snoozedUntil: null, automation: false }} size={34} />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <ThemedText variant="headline">{need.trunk.name}</ThemedText>
                  <ThemedText variant="subhead" tone="ink2">
                    {need.title}
                  </ThemedText>
                  {need.fields.map(([k, v]) => (
                    <ThemedText key={k} variant="caption1" tone="ink3">
                      {`${k}: ${v}`}
                    </ThemedText>
                  ))}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
                    <Chip title={need.yes} kind="ink" testID={`home-allow-${need.id}`} disabled={Boolean(approvals.sending[need.id])} onPress={() => onAnswer(need.id, 'allow-once')} />
                    <Chip title={need.no} testID={`home-deny-${need.id}`} disabled={Boolean(approvals.sending[need.id])} onPress={() => onAnswer(need.id, 'deny')} />
                    <Chip title="Look first" testID={`home-look-${need.id}`} onPress={() => onLookFirst(need.id, need.sessionKey)} />
                  </View>
                </View>
              </View>
            </HomeCard>
          ))
        ) : (
          <Calm testID="home-needs-empty" text="Nothing needs you." />
        )}

        <Section title="Working now" />
        {working.length ? (
          working.map((row) => {
            const step = workingStep(row);
            return (
              <HomeCard key={row.key} testID={`home-work-${row.key}`}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${step.text}`}
                  onPress={onOpenChat ? () => onOpenChat(row) : undefined}
                  disabled={!onOpenChat}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <Avatar row={row} size={30} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ThemedText variant="headline">{row.title}</ThemedText>
                      <ThemedText variant="caption1" tone="ink3">
                        {step.text}
                      </ThemedText>
                    </View>
                  </View>
                </Pressable>
                <View
                  testID={`home-still-${row.key}`}
                  accessibilityLabel={`${row.title}: Live`}
                  style={{ marginTop: space.sm, height: 120, borderRadius: 12, backgroundColor: color.ink, justifyContent: 'flex-end', padding: space.sm }}
                >
                  <View style={{ alignSelf: 'flex-start', backgroundColor: color.bg, borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 2 }}>
                    <ThemedText variant="caption2" style={{ fontWeight: '600' }}>
                      Live
                    </ThemedText>
                  </View>
                </View>
                <View
                  testID={`home-meter-${row.key}`}
                  accessibilityRole="progressbar"
                  accessibilityLabel={`${row.title}: working`}
                  style={{ marginTop: space.xs, height: 4, borderRadius: 2, backgroundColor: color.line, overflow: 'hidden' }}
                >
                  <View style={{ width: '50%', height: 4, backgroundColor: color.ink }} />
                </View>
                <View testID={`home-steps-${row.key}`} style={{ flexDirection: 'row', gap: 4, marginTop: space.sm }}>
                  {step.steps.map((s, i) => (
                    <View key={`${row.key}-st-${i}`} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: s === 'todo' ? color.line : color.ink }} />
                  ))}
                </View>
              </HomeCard>
            );
          })
        ) : (
          <Calm testID="home-working-empty" text="Nothing is running." />
        )}

        {advanced ? (
          <>
            <Section
              title="What’s left"
              action={
                <Pressable testID="home-all-accounts" accessibilityRole="button" onPress={() => showLater('What’s left')} hitSlop={8} style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
                  <ThemedText variant="footnote" style={{ fontWeight: '500' }}>
                    All accounts
                  </ThemedText>
                </Pressable>
              }
            />
            <HomeCard testID="home-usage">
              <ThemedText variant="subhead" tone="ink2">
                {laterUpdate('What’s left')}
              </ThemedText>
            </HomeCard>
          </>
        ) : null}

        <View testID="home-quick" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg }}>
          {quick.map((item) => (
            <Pressable
              key={item.id}
              testID={`home-quick-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => {
                if (item.id === 'new-chat') onNewChat();
                else if (item.id === 'computer') onComputer();
                else showLater(item.label as LaterHomeAction);
              }}
              style={({ pressed }) => ({
                width: '31%',
                flexGrow: 1,
                minHeight: layout.rowMinHeight + 12,
                backgroundColor: color.fill,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: space.md,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <ThemedText variant="caption1" tone="ink2" style={{ fontWeight: '600' }}>
                {item.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {later ? (
          <ThemedText testID="home-later" variant="footnote" tone="ink2" style={{ marginTop: space.sm }}>
            {later}
          </ThemedText>
        ) : null}

        {finished.length ? (
          <>
            <Section title="Finished" />
            <View testID="home-finished">
              {finished.map((row) => (
                <Pressable
                  key={row.key}
                  testID={`home-finished-${row.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${row.preview}`}
                  onPress={onOpenChat ? () => onOpenChat(row) : undefined}
                  disabled={!onOpenChat}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2, opacity: pressed ? 0.7 : 1 })}
                >
                  <Avatar row={row} size={28} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <ThemedText variant="headline" numberOfLines={1}>
                      {row.title}
                    </ThemedText>
                    <ThemedText variant="caption1" tone="ink2" numberOfLines={1}>
                      {row.preview}
                    </ThemedText>
                  </View>
                  <ThemedText variant="caption1" tone="ink3">
                    {chatTime(row.updatedAt, now)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <HomeCard testID="home-branch">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <ThemedText variant="title3" tone={online ? 'ok' : 'warn'} accessibilityLabel={`Connected · gateway ${gatewayWord(online)}`}>
              ●
            </ThemedText>
            <View style={{ flex: 1 }}>
              <ThemedText variant="headline">Branch on your computer</ThemedText>
              <ThemedText variant="caption1" tone="ink3">
                {`Gateway ${gatewayWord(online)}`}
              </ThemedText>
            </View>
          </View>
        </HomeCard>
      </ScrollView>
      <PlacesBar current="home" inboxCount={waiting} onPlace={onPlace} />
    </View>
  );
}
