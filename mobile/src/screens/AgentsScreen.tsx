import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PAUSE_UNAVAILABLE,
  STATUS_LABEL,
  type AgentListSnapshot,
  type AgentRow,
  type AgentStatus,
} from '../agents/agentList';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { OfflineBanner } from '../ui/OfflineBanner';

function statusTone(status: AgentStatus): 'ok' | 'warn' | 'ink3' {
  if (status === 'running') return 'ok';
  if (status === 'paused') return 'warn';
  return 'ink3';
}

function Avatar({ row }: { row: AgentRow }) {
  const { color, radius } = useTheme();
  return (
    <View style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: color.accentTint, alignItems: 'center', justifyContent: 'center' }}>
      <ThemedText variant="headline" tone="accentInk">
        {row.avatar}
      </ThemedText>
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

function AgentCard({
  row,
  canControl,
  sending,
  failed,
  confirming,
  onAskPause,
  onCancelPause,
  onPause,
  onResume,
}: {
  row: AgentRow;
  canControl: boolean;
  sending?: 'pause' | 'resume';
  failed?: string;
  confirming: boolean;
  onAskPause: () => void;
  onCancelPause: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const busy = Boolean(sending);
  const status = STATUS_LABEL[row.status];
  const fill = row.status === 'running' ? color.okTint : row.status === 'paused' ? color.warnTint : color.fill;
  return (
    <View
      testID={`agent-${row.id}`}
      style={{ backgroundColor: color.raise, borderRadius: radius.lg, padding: layout.cardInset, marginTop: space.md, gap: space.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar row={row} />
        <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
          <ThemedText variant="headline" numberOfLines={1}>
            {row.name}
          </ThemedText>
          <View
            testID={`status-${row.id}`}
            accessibilityLabel={status}
            style={{ alignSelf: 'flex-start', backgroundColor: fill, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs }}
          >
            <ThemedText variant="caption1" tone={statusTone(row.status)} style={{ fontWeight: '600' }}>
              {status}
            </ThemedText>
          </View>
        </View>
      </View>
      {canControl ? (
        confirming ? (
          <View testID={`confirm-pause-${row.id}`} style={{ gap: space.sm }}>
            <ThemedText variant="footnote" tone="ink2">
              {`${row.name} won’t start anything new until you resume it.`}
            </ThemedText>
            <Button title={`Pause ${row.name}`} kind="destructive" busy={sending === 'pause'} disabled={busy} onPress={onPause} testID={`confirm-pause-${row.id}-yes`} />
            <Button title="Keep running" kind="plain" disabled={busy} onPress={onCancelPause} testID={`confirm-pause-${row.id}-no`} />
          </View>
        ) : row.status === 'paused' ? (
          <Button title={`Resume ${row.name}`} kind="secondary" busy={sending === 'resume'} disabled={busy} onPress={onResume} testID={`resume-${row.id}`} />
        ) : (
          <Button title={`Pause ${row.name}`} kind="secondary" disabled={busy} onPress={onAskPause} testID={`pause-${row.id}`} />
        )
      ) : null}
      {failed ? (
        <ThemedText testID={`failed-${row.id}`} variant="footnote" tone="bad">
          {failed}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** The home computer's agents: name and running / paused / idle, with Pause / Resume when the engine offers it. */
export function AgentsScreen({
  list,
  online,
  onRefresh,
  onPause,
  onResume,
  onBack,
}: {
  list: AgentListSnapshot;
  online: boolean;
  onRefresh: () => Promise<void>;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onBack: () => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  let body;
  if (!list.loaded && !list.error) body = <Note testID="agents-loading" title="Checking with your computer…" body="The Trunks on your computer show up here." />;
  else if (!list.loaded)
    body = online ? (
      <Note testID="agents-error" title="Couldn’t load your agents" body={list.error || 'Your computer didn’t send its agents. Try again in a moment.'} action={{ title: 'Try again', onPress: () => void refresh() }} />
    ) : (
      <Note testID="agents-waiting" title="Waiting for your computer" body="Your agents show up here as soon as this phone reaches it." />
    );
  else if (list.rows.length === 0) body = <Note testID="agents-empty" title="No agents yet" body="Trunks you add on your computer show up here." />;
  else
    body = list.rows.map((row) => (
      <AgentCard
        key={row.id}
        row={row}
        canControl={list.canControl}
        sending={list.sending[row.id]}
        failed={list.failed[row.id]}
        confirming={confirming === row.id}
        onAskPause={() => setConfirming(row.id)}
        onCancelPause={() => setConfirming(null)}
        onPause={() => {
          setConfirming(null);
          onPause(row.id);
        }}
        onResume={() => onResume(row.id)}
      />
    ));

  return (
    <View testID="agents-screen" style={{ flex: 1, backgroundColor: color.grouped }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.xs, paddingHorizontal: layout.screenInset, paddingBottom: insets.bottom + space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.ink3} colors={[color.accent]} />}
      >
        <Pressable
          testID="agents-back"
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
        <ThemedText variant="largeTitle" accessibilityRole="header">
          Agents
        </ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          The Trunks on your computer, and whether each one is running, paused or idle.
        </ThemedText>
        {online ? null : <OfflineBanner testID="agents-offline" message="Reconnecting to your computer… These agents may be out of date." />}
        {list.loaded && !list.canControl ? (
          <View testID="agents-readonly" style={{ marginTop: space.md, backgroundColor: color.fill, borderRadius: radius.md, padding: space.md }}>
            <ThemedText variant="footnote" tone="ink2">
              {PAUSE_UNAVAILABLE}
            </ThemedText>
          </View>
        ) : null}
        {body}
      </ScrollView>
    </View>
  );
}
