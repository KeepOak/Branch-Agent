import { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComputerListSnapshot, ComputerRow } from '../computers/computerList';
import { chatTime } from '../chats/chatTime';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { NoScrollbarScrollView as ScrollView } from '../ui/NoScrollbar';
import { Card } from '../ui/Screen';
import { plainError } from '../ui/plainError';
import { useNow } from '../ui/useNow';

/** Status words plus the OS, and "Offline since Sunday" when the engine last saw it. */
export function computerLine(row: ComputerRow, now: number): string {
  const when = row.lastSeenAtMs ? chatTime(row.lastSeenAtMs, now) : '';
  const status = row.status === 'offline' && when ? `Offline since ${when}` : row.statusLabel;
  return [status, row.os].filter(Boolean).join(' · ');
}

function Note({ title, body, testID, action }: { title: string; body: string; testID: string; action?: { title: string; onPress: () => void } }) {
  const { space } = useTheme();
  return (
    <View testID={testID} style={{ paddingHorizontal: space.lg, paddingTop: space.xxxl, alignItems: 'center', gap: space.sm }}>
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

function StatusDot({ online, warn }: { online: boolean; warn: boolean }) {
  const { color, radius } = useTheme();
  return <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: online ? color.ok : warn ? color.warn : color.ink3 }} />;
}

function ComputerRowView({ row, now, last, onOpen }: { row: ComputerRow; now: number; last: boolean; onOpen?: (row: ComputerRow) => void }) {
  const { color, space, layout } = useTheme();
  const line = computerLine(row, now);
  const online = row.status === 'online';
  const label = onOpen ? `${row.name}, ${line}. Take control` : `${row.name}, ${line}`;
  return (
    <Pressable
      testID={`computer-${row.id}`}
      accessibilityRole={onOpen ? 'button' : 'text'}
      accessibilityLabel={label}
      onPress={onOpen ? () => onOpen(row) : undefined}
      disabled={!onOpen}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: layout.rowMinHeight,
        gap: space.md,
        paddingVertical: space.sm,
        borderBottomWidth: last ? 0 : layout.hairline,
        borderBottomColor: color.line,
        opacity: pressed && onOpen ? 0.7 : 1,
      })}
    >
      <StatusDot online={online} warn={row.status === 'starting' || row.status === 'stopping'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText variant="headline" numberOfLines={1}>
          {row.name}
        </ThemedText>
        <ThemedText variant="subhead" tone="ink2" numberOfLines={2}>
          {line}
        </ThemedText>
      </View>
      {onOpen ? (
        <ThemedText variant="body" tone="ink3">
          ›
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/** List of the computers Branch knows, with online/offline status. A tap opens take-control. No add, rename or manage. */
export function ComputersScreen({
  list,
  online,
  onRefresh,
  onBack,
  onThisPhone,
  onOpenComputer,
  now: fixedNow,
  backTo = 'Chats',
}: {
  list: ComputerListSnapshot;
  online: boolean;
  onRefresh: () => Promise<void>;
  onBack: () => void;
  /** Opens the pairing card for this phone (unpair lives there, not on this list). */
  onThisPhone?: () => void;
  /** Opens take-control for that computer. */
  onOpenComputer?: (row: ComputerRow) => void;
  now?: number;
  backTo?: 'Chats' | 'More' | 'Profile' | 'You';
}) {
  const { color, space, radius, layout } = useTheme();
  useNow(30_000);
  const now = fixedNow ?? Date.now();
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
  if (!list.loaded && !list.error) body = <Note testID="computers-loading" title="Checking with your computer…" body="The computers Branch can use show up here." />;
  else if (!list.loaded)
    body = online ? (
      <Note testID="computers-error" title="Couldn’t load your computers" body={plainError(list.error)} action={{ title: 'Try again', onPress: () => void refresh() }} />
    ) : (
      <Note testID="computers-waiting" title="Waiting for your computer" body="Your computers show up here as soon as this phone reaches it." />
    );
  else if (list.rows.length === 0) body = <Note testID="computers-empty" title="No computers yet" body="Computers you connect to Branch show up here with whether they’re online." />;
  else
    body = (
      <Card testID="computers-list">
        {list.rows.map((row, i) => (
          <ComputerRowView key={row.id} row={row} now={now} last={i === list.rows.length - 1} onOpen={onOpenComputer} />
        ))}
      </Card>
    );

  return (
    <View testID="computers-screen" style={{ flex: 1, backgroundColor: color.grouped }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.xs, paddingHorizontal: layout.screenInset, paddingBottom: insets.bottom + space.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.ink3} colors={[color.accent]} />}
      >
        <Pressable
          testID="computers-back"
          accessibilityRole="button"
          accessibilityLabel={`Back to ${backTo}`}
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <ThemedText variant="body" tone="accentInk">
            {`‹ ${backTo}`}
          </ThemedText>
        </Pressable>
        <ThemedText variant="largeTitle" accessibilityRole="header">
          Computers
        </ThemedText>
        {online ? null : (
          <View testID="computers-offline" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, backgroundColor: color.warnTint, borderRadius: radius.md, padding: space.md }}>
            <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.warn }} />
            <ThemedText variant="footnote" tone="ink2" style={{ flex: 1 }}>
              Reconnecting to your computer… These statuses may be out of date.
            </ThemedText>
          </View>
        )}
        {body}
        {onThisPhone ? (
          <Pressable
            testID="this-phone"
            accessibilityRole="button"
            accessibilityLabel="This phone, paired with your computer"
            onPress={onThisPhone}
            style={({ pressed }) => ({
              marginTop: space.xxl,
              backgroundColor: color.raise,
              borderRadius: radius.md,
              padding: layout.cardInset,
              minHeight: layout.rowMinHeight,
              flexDirection: 'row',
              alignItems: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText variant="headline">This phone</ThemedText>
              <ThemedText variant="subhead" tone="ink2">
                Paired with your computer
              </ThemedText>
            </View>
            <ThemedText variant="body" tone="ink3">
              ›
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
