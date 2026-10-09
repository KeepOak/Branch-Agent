import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHAT_FILTERS, filterRows, matchesSearch, unreadCount, type ChatFilter, type ChatListSnapshot, type ChatRow } from '../chats/chatList';
import { useMessageSearch, type MessageHit } from '../chats/messageSearch';
import { chatTime } from '../chats/chatTime';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { useNow } from '../ui/useNow';

const AVATAR = 52;
const SKELETON_ROWS = 6;

/** A chat's Trunk: its emoji or first letter, with a green dot while it works. */
export function Avatar({ row, size = AVATAR }: { row: ChatRow; size?: number }) {
  const { color, radius, type } = useTheme();
  const dot = size >= AVATAR ? 16 : 12;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: color.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText variant={size >= AVATAR ? 'title2' : 'headline'} tone="accentInk" style={{ lineHeight: size >= AVATAR ? type.title2.lineHeight : type.headline.lineHeight }}>
          {row.avatar}
        </ThemedText>
      </View>
      {row.working ? (
        <View
          testID={`working-${row.key}`}
          accessibilityLabel="Working now"
          style={{ position: 'absolute', right: 0, bottom: 0, width: dot, height: dot, borderRadius: radius.pill, backgroundColor: color.ok, borderWidth: dot === 16 ? 3 : 2, borderColor: color.bg }}
        />
      ) : null}
    </View>
  );
}

function ChatRowView({ row, now, onOpen }: { row: ChatRow; now: number; onOpen?: (row: ChatRow) => void }) {
  const { color, space, radius, layout } = useTheme();
  const when = chatTime(row.updatedAt, now);
  const line = row.preview || (row.trunkName ? `With ${row.trunkName}` : 'No messages yet');
  return (
    <Pressable
      testID={`chat-${row.key}`}
      accessibilityRole="button"
      accessibilityLabel={[row.title, row.unread ? 'unread' : '', row.needsYou ? 'needs you' : '', row.working ? 'working now' : '', line, when].filter(Boolean).join(', ')}
      onPress={onOpen ? () => onOpen(row) : undefined}
      disabled={!onOpen}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenInset, paddingVertical: space.sm + 2, gap: space.md, backgroundColor: pressed ? color.fill : 'transparent' })}
    >
      <Avatar row={row} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
          <ThemedText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {row.title}
          </ThemedText>
          <ThemedText variant="subhead" tone={row.unread ? 'accentInk' : 'ink3'}>
            {when}
          </ThemedText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xxs }}>
          <ThemedText variant="subhead" tone="ink2" numberOfLines={2} style={{ flex: 1 }}>
            {line}
          </ThemedText>
          {row.needsYou ? (
            <View style={{ backgroundColor: color.warnTint, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs }}>
              <ThemedText variant="caption1" tone="warn" style={{ fontWeight: '600' }}>
                Needs you
              </ThemedText>
            </View>
          ) : null}
          {row.unread ? <View testID={`unread-${row.key}`} style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color.accent }} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** A small grouped-list heading: Pinned, Recent, Chats, Messages. */
function SectionHeader({ title }: { title: string }) {
  const { space, layout } = useTheme();
  return (
    <View testID={`section-${title}`} accessibilityRole="header" style={{ paddingHorizontal: layout.screenInset, paddingTop: space.lg, paddingBottom: space.xs }}>
      <ThemedText variant="footnote" tone="ink3" style={{ fontWeight: '600', textTransform: 'uppercase' }}>
        {title}
      </ThemedText>
    </View>
  );
}

/** One message that matched, under the chat it was said in. */
function MessageHitView({ hit, row, now, onOpen }: { hit: MessageHit; row: ChatRow | undefined; now: number; onOpen?: (row: ChatRow) => void }) {
  const { color, space, layout } = useTheme();
  const title = row?.title ?? 'A chat';
  const when = chatTime(hit.at, now);
  return (
    <Pressable
      testID={`hit-${hit.key}-${hit.messageId}`}
      accessibilityRole="button"
      accessibilityLabel={[title, hit.role === 'user' ? 'you said' : '', hit.snippet, when].filter(Boolean).join(', ')}
      onPress={row && onOpen ? () => onOpen(row) : undefined}
      disabled={!row || !onOpen}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenInset, paddingVertical: space.sm + 2, gap: space.md, backgroundColor: pressed ? color.fill : 'transparent' })}
    >
      {row ? <Avatar row={row} /> : <View style={{ width: AVATAR }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
          <ThemedText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </ThemedText>
          <ThemedText variant="subhead" tone="ink3">
            {when}
          </ThemedText>
        </View>
        <ThemedText variant="subhead" tone="ink2" numberOfLines={2} style={{ marginTop: space.xxs }}>
          {hit.role === 'user' ? `You: ${hit.snippet}` : hit.snippet}
        </ThemedText>
      </View>
    </Pressable>
  );
}

/** The filter chips: one tap narrows the list, and each says how many need a look. */
function FilterChips({ value, onChange, counts }: { value: ChatFilter; onChange: (f: ChatFilter) => void; counts: Record<ChatFilter, number> }) {
  const { color, space, radius, layout } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID="chat-filters"
      accessibilityRole="tablist"
      style={{ marginTop: space.md, marginHorizontal: -layout.screenInset }}
      contentContainerStyle={{ paddingHorizontal: layout.screenInset, gap: space.sm }}
    >
      {CHAT_FILTERS.filter(([id]) => id === 'all' || id === value || counts[id] > 0).map(([id, label]) => {
        const on = id === value;
        return (
          <Pressable
            key={id}
            testID={`filter-${id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={id === 'all' ? label : `${label}, ${counts[id]}`}
            onPress={() => onChange(id)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => ({
              minHeight: 32,
              justifyContent: 'center',
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: on ? color.accent : color.fill,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ThemedText variant="subhead" tone={on ? 'onAccent' : 'ink'} style={{ fontWeight: on ? '600' : '400' }}>
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** What an empty chip says, so an empty list is never a puzzle. */
const EMPTY: Record<ChatFilter, [string, string]> = {
  all: ['No chats yet', 'Start a chat with a Trunk on your computer and it shows up here.'],
  trunks: ['No Trunk chats', 'Chats with a single Trunk show up here.'],
  rooms: ['No rooms yet', 'Rooms with several Trunks show up here.'],
  needsYou: ['Nothing needs you', 'When a Trunk is waiting for a yes or an answer, its chat shows up here.'],
  snoozed: ['Nothing snoozed', 'Snoozed chats wait here until their time, then come back by themselves.'],
  archived: ['Nothing archived', 'Archived chats are kept here.'],
  automations: ['No automation chats', 'Chats that automations start show up here.'],
};

type Item =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'row'; key: string; row: ChatRow }
  | { kind: 'hit'; key: string; hit: MessageHit };

const heading = (title: string): Item => ({ kind: 'header', key: `header:${title}`, title });
const chat = (row: ChatRow): Item => ({ kind: 'row', key: row.key, row });

/** The list under the chips: Pinned and Recent groups in All when something is pinned, else the chip's rows. */
export function browseItems(rows: ChatRow[], filter: ChatFilter, now: number): Item[] {
  const shown = filterRows(rows, filter, now);
  const pinned = shown.filter((row) => row.pinned);
  if (filter !== 'all' || pinned.length === 0) return shown.map(chat);
  const rest = shown.filter((row) => !row.pinned);
  return [heading('Pinned'), ...pinned.map(chat), ...(rest.length ? [heading('Recent'), ...rest.map(chat)] : [])];
}

/** While typing: the chats whose name, Trunk or last line match, then the messages that do. */
export function searchItems(rows: ChatRow[], query: string, hits: MessageHit[]): Item[] {
  const chats = rows.filter((row) => matchesSearch(row, query));
  const known = new Set(rows.map((row) => row.key));
  const messages = hits.filter((hit) => known.has(hit.key));
  return [
    ...(chats.length ? [heading('Chats'), ...chats.map(chat)] : []),
    ...(messages.length ? [heading('Messages'), ...messages.map((hit): Item => ({ kind: 'hit', key: `hit:${hit.key}:${hit.messageId}`, hit }))] : []),
  ];
}

/** Grey rows in the shape of real ones, until the first read lands: never a blank list. */
function Skeleton() {
  const { color, space, radius, layout } = useTheme();
  return (
    <View testID="chats-loading" accessibilityLabel="Loading your chats">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenInset, paddingVertical: space.sm + 2, gap: space.md }}>
          <View style={{ width: AVATAR, height: AVATAR, borderRadius: radius.pill, backgroundColor: color.fill }} />
          <View style={{ flex: 1, gap: space.sm }}>
            <View style={{ width: `${45 + ((i * 17) % 30)}%`, height: 14, borderRadius: radius.sm, backgroundColor: color.fill }} />
            <View style={{ width: `${70 + ((i * 11) % 25)}%`, height: 12, borderRadius: radius.sm, backgroundColor: color.fill }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Note({ title, body, testID, action }: { title: string; body: string; testID: string; action?: { title: string; onPress: () => void } }) {
  const { space, layout } = useTheme();
  return (
    <View testID={testID} style={{ paddingHorizontal: layout.screenInset + space.lg, paddingTop: space.xxxl * 2, alignItems: 'center', gap: space.sm }}>
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

/** The paired home: every chat with your Trunks, newest first, live from the computer. */
export function ChatsScreen({
  list,
  online,
  onRefresh,
  onComputer,
  onOpen,
  searchMessages,
  needsYou,
  onNeedsYou,
  now: fixedNow,
}: {
  list: ChatListSnapshot;
  online: boolean;
  onRefresh: () => Promise<void>;
  onComputer: () => void;
  /** Opens a chat. */
  onOpen?: (row: ChatRow) => void;
  /** Searches every chat's messages (sessions.search); without it, search matches names and last lines. */
  searchMessages?: (query: string) => Promise<unknown>;
  /** Approvals waiting for a yes: how many, and the oldest one in a line ("Oak · Run a command"). */
  needsYou?: { count: number; line: string } | null;
  onNeedsYou?: () => void;
  /** A fixed time for tests and screenshots; otherwise the phone's clock, read again every half minute. */
  now?: number;
}) {
  const { color, space, radius, layout, type } = useTheme();
  // The list can stay open for hours: a render every half minute moves rows from "Now" to a time, and from
  // today to "Yesterday", by themselves. Each render reads the clock, so a fresh row is never in the future.
  useNow(30_000);
  const now = fixedNow ?? Date.now();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const typing = query.trim().length > 0;
  const messages = useMessageSearch(searchMessages, query);
  const waiting = unreadCount(list.rows, now);
  const counts = Object.fromEntries(CHAT_FILTERS.map(([id]) => [id, filterRows(list.rows, id, now).length])) as Record<ChatFilter, number>;
  const byKey = new Map(list.rows.map((row) => [row.key, row]));
  const items = typing ? searchItems(list.rows, query, messages.hits) : browseItems(list.rows, filter, now);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const header = (
    <View style={{ paddingTop: insets.top + space.xs, paddingHorizontal: layout.screenInset, paddingBottom: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Pressable
          testID="computer-button"
          accessibilityRole="button"
          accessibilityLabel={online ? 'Your computer, connected' : 'Your computer, reconnecting'}
          onPress={onComputer}
          hitSlop={8}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, gap: space.xs + 2, opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: online ? color.ok : color.warn }} />
          <ThemedText variant="body" tone="accentInk">
            Computer
          </ThemedText>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <ThemedText variant="largeTitle" accessibilityRole="header">
          Chats
        </ThemedText>
        {waiting ? (
          <View
            testID="chats-count"
            accessibilityLabel={`${waiting} ${waiting === 1 ? 'chat wants' : 'chats want'} a look`}
            style={{ minWidth: 24, height: 24, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <ThemedText variant="footnote" tone="onAccent" style={{ fontWeight: '700' }}>
              {waiting}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {needsYou && needsYou.count > 0 ? (
        <Pressable
          testID="needs-you-banner"
          accessibilityRole="button"
          accessibilityLabel={`${needsYou.count} ${needsYou.count === 1 ? 'approval needs' : 'approvals need'} your yes. ${needsYou.line}`}
          onPress={onNeedsYou}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, backgroundColor: color.warnTint, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: layout.rowMinHeight + 12, opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ minWidth: 26, height: 26, paddingHorizontal: space.xs, borderRadius: radius.pill, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' }}>
            <ThemedText variant="footnote" tone="onAccent" style={{ fontWeight: '700' }}>
              {needsYou.count}
            </ThemedText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText variant="headline">{needsYou.count === 1 ? 'Needs your yes' : 'Need your yes'}</ThemedText>
            <ThemedText variant="footnote" tone="ink2" numberOfLines={1}>
              {needsYou.line}
            </ThemedText>
          </View>
          <ThemedText variant="body" tone="ink3">
            ›
          </ThemedText>
        </Pressable>
      ) : null}
      <TextInput
        testID="chat-search"
        value={query}
        onChangeText={setQuery}
        placeholder={searchMessages ? 'Search chats and messages' : 'Search chats'}
        placeholderTextColor={color.ink3}
        clearButtonMode="while-editing"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search chats"
        style={{
          ...type.body,
          color: color.ink,
          backgroundColor: color.fill,
          borderRadius: radius.md - 2,
          paddingHorizontal: space.md,
          height: 38,
          marginTop: space.sm,
        }}
      />
      {typing || !list.loaded ? null : <FilterChips value={filter} onChange={setFilter} counts={counts} />}
      {typing && messages.note ? (
        <ThemedText testID="search-note" variant="footnote" tone="ink3" style={{ marginTop: space.sm }}>
          {messages.note}
        </ThemedText>
      ) : null}
      {online ? null : (
        <View testID="chats-offline" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, backgroundColor: color.warnTint, borderRadius: radius.md, padding: space.md }}>
          <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.warn }} />
          <ThemedText variant="footnote" tone="ink2" style={{ flex: 1 }}>
            Reconnecting to your computer… These chats may be out of date.
          </ThemedText>
        </View>
      )}
    </View>
  );

  let empty;
  if (!list.loaded && !list.error) empty = <Skeleton />;
  else if (!list.loaded && list.error)
    empty = online ? (
      <Note testID="chats-error" title="Couldn’t load your chats" body={list.error} action={{ title: 'Try again', onPress: () => void refresh() }} />
    ) : (
      <Note testID="chats-waiting" title="Waiting for your computer" body="Your chats show up here as soon as this phone reaches it." />
    );
  else if (typing && messages.searching) empty = <Note testID="chats-searching" title="Searching…" body="Looking through every chat’s messages." />;
  else if (typing) empty = <Note testID="chats-no-match" title="No results" body={`No chats or messages match “${query.trim()}”.`} />;
  else if (filter === 'all') empty = <Note testID="chats-empty" title={EMPTY.all[0]} body={EMPTY.all[1]} />;
  else empty = <Note testID={`chats-empty-${filter}`} title={EMPTY[filter][0]} body={EMPTY[filter][1]} action={{ title: 'Show all chats', onPress: () => setFilter('all') }} />;

  return (
    <View testID="chats-screen" style={{ flex: 1, backgroundColor: color.bg }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <SectionHeader title={item.title} />
          ) : item.kind === 'hit' ? (
            <MessageHitView hit={item.hit} row={byKey.get(item.hit.key)} now={now} onOpen={onOpen} />
          ) : (
            <ChatRowView row={item.row} now={now} onOpen={onOpen} />
          )
        }
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={({ leadingItem }: { leadingItem?: Item }) =>
          leadingItem && leadingItem.kind !== 'header' ? <View style={{ height: layout.hairline, backgroundColor: color.line, marginLeft: layout.screenInset + AVATAR + space.md }} /> : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.ink3} colors={[color.accent]} />}
      />
    </View>
  );
}
