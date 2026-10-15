import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_LABEL, type AgentListSnapshot, type AgentRow, type AgentStatus } from '../agents/agentList';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { OfflineBanner } from '../ui/OfflineBanner';

function statusTone(status: AgentStatus): 'ok' | 'ink3' {
  return status === 'running' ? 'ok' : 'ink3';
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

function AgentCard({ row }: { row: AgentRow }) {
  const { color, space, radius, layout } = useTheme();
  const status = STATUS_LABEL[row.status];
  const fill = row.status === 'running' ? color.okTint : color.fill;
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
    </View>
  );
}

/** The home computer's agents: name and running / idle. Read-only; Pause / Resume live on the computer. */
export function AgentsScreen({
  list,
  online,
  onRefresh,
  onBack,
}: {
  list: AgentListSnapshot;
  online: boolean;
  onRefresh: () => Promise<void>;
  onBack: () => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

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
  else body = list.rows.map((row) => <AgentCard key={row.id} row={row} />);

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
          The Trunks on your computer, and whether each one is running or idle.
        </ThemedText>
        {online ? null : <OfflineBanner testID="agents-offline" message="Reconnecting to your computer… These agents may be out of date." />}
        {list.loaded && list.error && online ? (
          <View testID="agents-error" style={{ marginTop: space.md, backgroundColor: color.badTint, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
            <ThemedText variant="footnote" tone="bad">
              {list.error}
            </ThemedText>
            <Button title="Try again" kind="secondary" onPress={() => void refresh()} testID="agents-error-action" />
          </View>
        ) : null}
        {body}
      </ScrollView>
    </View>
  );
}
