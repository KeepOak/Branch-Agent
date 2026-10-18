import { useState, type ReactNode } from 'react';
import { FlatList, Modal, Platform, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchingActions, runAction, type ActionHit } from '../chats/chatActions';
import {
  CHAT_FILTERS,
  filterRows,
  matchesSearch,
  pinnedTrunks,
  sortRows,
  unreadCount,
  type ChatFilter,
  type ChatLayout,
  type ChatListExtra,
  type ChatListSnapshot,
  type ChatRow,
  type ChatSort,
  type ChatStatusFilter,
} from '../chats/chatList';
import { statusChip, unreadBadge } from '../chats/chatStatus';
import { useMessageSearch, type MessageHit } from '../chats/messageSearch';
import { chatTime } from '../chats/chatTime';
import { laterUpdate, levelRank, type ExperienceLevel } from '../settings/level';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { OfflineBanner } from '../ui/OfflineBanner';
import { statusBandHeight } from '../ui/PlacesBar';
import { plainError } from '../ui/plainError';
import { useNow } from '../ui/useNow';

const AVATAR = 52;
const PIN_AVATAR = 44;
const SKELETON_ROWS = 6;
const STATUS_LABEL: Record<ChatStatusFilter, string> = {
  all: 'All',
  working: 'Working',
  waiting: 'Waiting for you',
  idle: 'Idle',
};

/** A chat's Trunk: its emoji or first letter, with a green dot while it works. */
export function Avatar({ row, size = AVATAR }: { row: ChatRow; size?: number }) {
  const { color, radius, type } = useTheme();
  const dot = size >= AVATAR ? 16 : 12;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText variant={size >= AVATAR ? 'title2' : 'headline'} style={{ lineHeight: size >= AVATAR ? type.title2.lineHeight : type.headline.lineHeight }}>
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

function StatusChipView({ row, compact = false }: { row: ChatRow; compact?: boolean }) {
  const { color, space, radius } = useTheme();
  const chip = statusChip(row);
  if (!chip) return null;
  const work = chip.kind === 'working';
  return (
    <View
      testID={`status-${row.key}`}
      accessibilityLabel={chip.label}
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 4 : 5,
        marginTop: compact ? 0 : 4,
        paddingHorizontal: compact ? 6 : space.sm,
        paddingVertical: compact ? 1 : 2,
        borderRadius: radius.pill,
        borderWidth: work ? 0 : 1,
        borderColor: color.line,
        backgroundColor: work ? color.ink : color.fill,
      }}
    >
      <View style={{ width: compact ? 6 : 7, height: compact ? 6 : 7, borderRadius: radius.pill, backgroundColor: color[chip.dot] }} />
      <ThemedText variant="caption2" tone="ink2" style={{ color: work ? color.bg : color.ink2, fontSize: compact ? 10.5 : 11.5 }}>
        {chip.label}
      </ThemedText>
    </View>
  );
}

function ChatRowView({
  row,
  now,
  onOpen,
  layout,
}: {
  row: ChatRow;
  now: number;
  onOpen?: (row: ChatRow) => void;
  layout: ChatLayout;
}) {
  const { color, space, radius, layout: box } = useTheme();
  const compact = layout === 'compact';
  const when = chatTime(row.updatedAt, now);
  const line = row.preview || (row.trunkName ? `With ${row.trunkName}` : 'No messages yet');
  const unread = unreadBadge(row);
  return (
    <Pressable
      testID={`chat-${row.key}`}
      accessibilityRole="button"
      accessibilityLabel={[row.title, row.unread ? 'unread' : '', row.needsYou ? 'needs you' : '', row.working ? 'working now' : '', compact ? '' : line, when].filter(Boolean).join(', ')}
      onPress={onOpen ? () => onOpen(row) : undefined}
      disabled={!onOpen}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: box.screenInset, paddingVertical: compact ? space.sm : space.sm + 2, gap: space.md, backgroundColor: pressed ? color.fill : 'transparent' })}
    >
      <Avatar row={row} size={compact ? 32 : AVATAR} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
          <ThemedText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {row.title}
          </ThemedText>
          <ThemedText variant="subhead" tone={row.unread ? 'ink' : 'ink3'}>
            {when}
          </ThemedText>
        </View>
        {compact ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xxs }}>
            <ThemedText variant="subhead" tone="ink2" numberOfLines={2} style={{ flex: 1 }}>
              {line}
            </ThemedText>
            {row.needsYou ? (
              <View style={{ backgroundColor: color.fill, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs, borderWidth: 1, borderColor: color.line }}>
                <ThemedText variant="caption1" style={{ fontWeight: '600' }}>
                  Needs you
                </ThemedText>
              </View>
            ) : null}
            {unread ? (
              <View testID={`unread-${row.key}`} accessibilityLabel={`${unread} unread`} style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}>
                <ThemedText variant="caption2" style={{ color: color.bg, fontWeight: '600' }}>
                  {unread}
                </ThemedText>
              </View>
            ) : null}
          </View>
        )}
        {compact && unread ? (
          <View testID={`unread-${row.key}`} accessibilityLabel={`${unread} unread`} style={{ position: 'absolute', right: 0, top: 22, minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}>
            <ThemedText variant="caption2" style={{ color: color.bg, fontWeight: '600' }}>
              {unread}
            </ThemedText>
          </View>
        ) : null}
        {compact ? null : <StatusChipView row={row} />}
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

function ActionHitView({ hit, onRun }: { hit: ActionHit; onRun: (hit: ActionHit) => void }) {
  const { color, space, radius, layout } = useTheme();
  return (
    <Pressable
      testID={`action-${hit.id}`}
      accessibilityRole="button"
      accessibilityLabel={[hit.title, hit.line].join(', ')}
      disabled={hit.later}
      onPress={hit.later ? undefined : () => onRun(hit)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenInset, paddingVertical: space.sm + 2, gap: space.md, backgroundColor: pressed ? color.fill : 'transparent', opacity: hit.later ? 0.7 : 1 })}
    >
      <View style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText variant="headline">+</ThemedText>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText variant="headline" numberOfLines={1}>
          {hit.title}
        </ThemedText>
        <ThemedText variant="subhead" tone="ink2" numberOfLines={2} style={{ marginTop: space.xxs }}>
          {hit.line}
        </ThemedText>
      </View>
    </Pressable>
  );
}

/** The filter chips: one tap narrows the list, and each says how many need a look. */
function FilterChips({
  value,
  onChange,
  counts,
  look,
  filterOn,
  onFilter,
}: {
  value: ChatFilter;
  onChange: (f: ChatFilter) => void;
  counts: Record<ChatFilter, number>;
  look: 'ios' | 'android';
  filterOn: boolean;
  onFilter: () => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const android = look === 'android';
  return (
    <View testID="chat-filters" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, marginHorizontal: -layout.screenInset, paddingRight: layout.screenInset }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        style={{ flex: 1 }}
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
                borderRadius: android ? radius.sm : radius.pill,
                borderWidth: android && !on ? 1 : 0,
                borderColor: color.line,
                backgroundColor: on ? color.ink : android ? 'transparent' : color.fill,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <ThemedText variant="subhead" style={{ fontWeight: on ? '600' : '400', color: on ? color.bg : color.ink }}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable
        testID="chats-filter"
        accessibilityRole="button"
        accessibilityLabel="Filter and sort"
        accessibilityState={{ selected: filterOn }}
        onPress={onFilter}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: radius.pill,
          backgroundColor: filterOn ? color.ink : color.fill,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ width: 16, height: 12, justifyContent: 'space-between' }}>
          <View style={{ height: 2, backgroundColor: filterOn ? color.bg : color.ink, width: '100%' }} />
          <View style={{ height: 2, backgroundColor: filterOn ? color.bg : color.ink, width: '70%', alignSelf: 'center' }} />
          <View style={{ height: 2, backgroundColor: filterOn ? color.bg : color.ink, width: '85%' }} />
        </View>
      </Pressable>
    </View>
  );
}

function PinnedRow({ pins, onOpen }: { pins: ChatRow[]; onOpen?: (row: ChatRow) => void }) {
  const { space, layout } = useTheme();
  return (
    <ScrollView
      horizontal
      testID="pinned-trunks"
      accessibilityRole="list"
      accessibilityLabel="Pinned Trunks"
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -layout.screenInset }}
      contentContainerStyle={{ paddingHorizontal: layout.screenInset, paddingTop: space.sm, paddingBottom: space.md, gap: 14 }}
    >
      {pins.map((row) => (
        <Pressable
          key={row.key}
          testID={`pin-${row.key}`}
          accessibilityRole="button"
          accessibilityLabel={[row.title, statusChip(row)?.label].filter(Boolean).join(', ')}
          onPress={onOpen ? () => onOpen(row) : undefined}
          disabled={!onOpen}
          style={{ width: 76, alignItems: 'center', gap: 4 }}
        >
          <Avatar row={row} size={PIN_AVATAR} />
          <ThemedText variant="caption1" numberOfLines={1} style={{ maxWidth: 76 }}>
            {row.title}
          </ThemedText>
          <StatusChipView row={row} compact />
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** What an empty chip says, so an empty list is never a puzzle. */
const EMPTY: Record<ChatFilter, [string, string]> = {
  all: ['No chats yet', 'Start a chat with a Trunk on your computer and it shows up here.'],
  trunks: ['No Trunk chats', 'Chats with a single Trunk show up here.'],
  rooms: ['No rooms yet', 'Rooms with several Trunks show up here.'],
  unread: ['Nothing unread', 'Chats with something new, or waiting for you, show up here.'],
  needsYou: ['Nothing needs you', 'When a Trunk is waiting for a yes or an answer, its chat shows up here.'],
  snoozed: ['Nothing snoozed', 'Snoozed chats wait here until their time, then come back by themselves.'],
  archived: ['Nothing archived', 'Archived chats are kept here.'],
  automations: ['No automation chats', 'Chats that automations start show up here.'],
};

type Item =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'row'; key: string; row: ChatRow }
  | { kind: 'hit'; key: string; hit: MessageHit }
  | { kind: 'action'; key: string; action: ActionHit };

const heading = (title: string): Item => ({ kind: 'header', key: `header:${title}`, title });
const chat = (row: ChatRow): Item => ({ kind: 'row', key: row.key, row });

/** The list under the chips: Pinned and Recent groups in All when something is pinned, else the chip's rows. */
export function browseItems(rows: ChatRow[], filter: ChatFilter, now: number, extra?: ChatListExtra & { pinRow?: boolean }): Item[] {
  const shown = sortRows(filterRows(rows, filter, now, extra), extra?.sort);
  const pinned = shown.filter((row) => row.pinned);
  const rest = shown.filter((row) => !row.pinned);
  // The r50 pin row already shows pinned Trunks, so All only lists Recent under it.
  if (extra?.pinRow && filter === 'all' && pinned.length > 0) {
    return rest.length ? [heading('Recent'), ...rest.map(chat)] : [];
  }
  if (filter !== 'all' || pinned.length === 0) return shown.map(chat);
  return [heading('Pinned'), ...pinned.map(chat), ...(rest.length ? [heading('Recent'), ...rest.map(chat)] : [])];
}

/** While typing: the chats whose name, Trunk or last line match, then the messages that do. */
export function searchItems(rows: ChatRow[], query: string, hits: MessageHit[], actions: ActionHit[] = []): Item[] {
  const chats = rows.filter((row) => matchesSearch(row, query));
  const known = new Set(rows.map((row) => row.key));
  const messages = hits.filter((hit) => known.has(hit.key));
  return [
    ...(chats.length ? [heading('Chats'), ...chats.map(chat)] : []),
    ...(messages.length ? [heading('Messages'), ...messages.map((hit): Item => ({ kind: 'hit', key: `hit:${hit.key}:${hit.messageId}`, hit }))] : []),
    ...(actions.length ? [heading('Actions'), ...actions.map((action): Item => ({ kind: 'action', key: `action:${action.id}`, action }))] : []),
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

function Sheet({
  title,
  testID,
  onClose,
  children,
}: {
  title: string;
  testID: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { color, space, radius, layout } = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID={testID}>
      <Pressable testID={`${testID}-scrim`} onPress={onClose} style={{ flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => undefined}
          style={{ backgroundColor: color.raise, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: layout.screenInset, paddingTop: space.lg, paddingBottom: space.xxxl }}
        >
          <ThemedText variant="headline" accessibilityRole="header">
            {title}
          </ThemedText>
          <View style={{ marginTop: space.md }}>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RadioRow({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  const { color, layout } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: layout.rowMinHeight,
        opacity: pressed ? 0.7 : 1,
        borderBottomWidth: layout.hairline,
        borderBottomColor: color.line,
      })}
    >
      <ThemedText variant="body">{label}</ThemedText>
      {selected ? (
        <ThemedText variant="body" tone="ink3">
          ✓
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/** The paired chats list: every chat with your Trunks, newest first, live from the computer. */
export function ChatsScreen({
  list,
  online,
  onRefresh,
  onComputer,
  onAgents,
  onSettings,
  onMore,
  onOpen,
  onNewChat,
  searchMessages,
  needsYou,
  onNeedsYou,
  now: fixedNow,
  updateBanner,
  level = 'regular',
  look = Platform.OS === 'ios' ? 'ios' : 'android',
  bottomExtra = 0,
}: {
  list: ChatListSnapshot;
  online: boolean;
  onRefresh: () => Promise<void>;
  /** Opens Computers. */
  onComputer: () => void;
  /** Opens Agents. With it, the top bar has an Agents button next to Settings. */
  onAgents?: () => void;
  /** Opens Settings. */
  onSettings?: () => void;
  /** Opens More. */
  onMore?: () => void;
  /** Opens a chat. */
  onOpen?: (row: ChatRow) => void;
  /** Starts or carries on a conversation (the preview's New chat). */
  onNewChat?: () => void;
  /** Searches every chat's messages (sessions.search); without it, search matches names and last lines. */
  searchMessages?: (query: string) => Promise<unknown>;
  /** Approvals waiting for a yes: how many, and the oldest one in a line ("Oak · Run a command"). */
  needsYou?: { count: number; line: string } | null;
  /** Opens Approvals. With it, the top bar always has an Approvals button, with the count when any wait. */
  onNeedsYou?: () => void;
  /** A fixed time for tests and screenshots; otherwise the phone's clock, read again every half minute. */
  now?: number;
  /** Sideloaded Android APK update, when one is ready or in flight. */
  updateBanner?: ReactNode;
  /** Regular hides unfinished rows; Advanced and Technical show them as later-update. */
  level?: ExperienceLevel;
  /** Android uses the preview's app bar, chips and New chat FAB. */
  look?: 'ios' | 'android';
  /** Extra list padding above a floating Places bar. */
  bottomExtra?: number;
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
  const [status, setStatus] = useState<ChatStatusFilter>('all');
  const [includeAutos, setIncludeAutos] = useState(false);
  const [sort, setSort] = useState<ChatSort>('new');
  const [listLayout, setListLayout] = useState<ChatLayout>('detailed');
  const [sheet, setSheet] = useState<null | 'filter' | 'filter-status' | 'sort'>(null);
  const typing = query.trim().length > 0;
  const messages = useMessageSearch(searchMessages, query);
  const waiting = unreadCount(list.rows, now);
  const extra: ChatListExtra = { status, includeAutos, sort };
  const counts = Object.fromEntries(CHAT_FILTERS.map(([id]) => [id, filterRows(list.rows, id, now, extra).length])) as Record<ChatFilter, number>;
  const byKey = new Map(list.rows.map((row) => [row.key, row]));
  const handlers = { onNewChat, onSettings, onComputer, onAgents, onNeedsYou };
  const actions = typing ? matchingActions(query, level, handlers) : [];
  const items = typing ? searchItems(list.rows, query, messages.hits, actions) : browseItems(list.rows, filter, now, { ...extra, pinRow: true });
  const pins = !typing && list.loaded ? pinnedTrunks(list.rows, now, extra) : [];
  const showPins = !typing && filter === 'all' && pins.length > 0;
  const showNewTrunk = !typing && list.loaded && (filter === 'all' || filter === 'trunks') && levelRank(level) >= 1;
  const showSort = levelRank(level) >= 1;
  const filterOn = status !== 'all' || includeAutos;
  const android = look === 'android';

  const approvals = needsYou?.count ?? 0;
  // The count beside the title opens what it counts: Approvals while any wait (their chats are in it), else Unread.
  const openCount = () => {
    if (approvals > 0 && onNeedsYou) onNeedsYou();
    else setFilter('unread');
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const newChat = (
    <Pressable
      testID="chats-new"
      accessibilityRole="button"
      accessibilityLabel="New chat"
      onPress={onNewChat}
      disabled={!onNewChat}
      hitSlop={8}
      style={({ pressed }) =>
        android
          ? {
              position: 'absolute',
              right: layout.screenInset,
              bottom: insets.bottom + 18,
              height: 56,
              paddingHorizontal: 20,
              borderRadius: 18,
              backgroundColor: color.ink,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              opacity: pressed ? 0.7 : 1,
            }
          : { minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 }
      }
    >
      <ThemedText variant={android ? 'subhead' : 'body'} style={{ fontWeight: '600', color: android ? color.bg : color.ink }}>
        {android ? '+  New chat' : 'New chat'}
      </ThemedText>
    </Pressable>
  );

  const header = (
    <View style={{ paddingTop: statusBandHeight(look, insets.top) + space.xs, paddingHorizontal: layout.screenInset, paddingBottom: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: onNeedsYou ? 'space-between' : 'flex-end', alignItems: 'center' }}>
        {onNeedsYou ? (
          <Pressable
            testID="approvals-button"
            accessibilityRole="button"
            accessibilityLabel={approvals ? `Approvals, ${approvals} waiting` : 'Approvals, nothing waiting'}
            onPress={onNeedsYou}
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, gap: space.xs + 2, opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText variant="body">{'Approvals'}</ThemedText>
            {approvals ? (
              <View testID="approvals-button-count" style={{ minWidth: 22, height: 22, paddingHorizontal: space.xs + 2, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}>
                <ThemedText variant="footnote" style={{ fontWeight: '700', color: color.bg }}>
                  {approvals}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          {onMore ? (
            <Pressable
              testID="more-button"
              accessibilityRole="button"
              accessibilityLabel="More"
              onPress={onMore}
              hitSlop={8}
              style={({ pressed }) => ({ minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText variant="body">More</ThemedText>
            </Pressable>
          ) : null}
          {onSettings ? (
            <Pressable
              testID="settings-button"
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={onSettings}
              hitSlop={8}
              style={({ pressed }) => ({ minHeight: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText variant="body">Settings</ThemedText>
            </Pressable>
          ) : null}
          {onAgents ? (
            <Pressable
              testID="agents-button"
              accessibilityRole="button"
              accessibilityLabel="Agents"
              onPress={onAgents}
              hitSlop={8}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText variant="body">Agents</ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            testID="computer-button"
            accessibilityRole="button"
            accessibilityLabel={online ? 'Computers, connected' : 'Computers, reconnecting'}
            onPress={onComputer}
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, gap: space.xs + 2, opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: online ? color.ok : color.warn }} />
            <ThemedText variant="body">Computers</ThemedText>
          </Pressable>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <ThemedText variant={android ? 'title2' : 'largeTitle'} accessibilityRole="header" style={{ flexShrink: 1 }}>
          Chats
        </ThemedText>
        {waiting ? (
          <Pressable
            testID="chats-count"
            accessibilityRole="button"
            accessibilityLabel={`${waiting} ${waiting === 1 ? 'chat wants' : 'chats want'} a look. ${approvals > 0 && onNeedsYou ? 'Opens Approvals' : 'Shows them'}`}
            onPress={openCount}
            hitSlop={10}
            style={({ pressed }) => ({ minWidth: 24, height: 24, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <ThemedText variant="footnote" style={{ fontWeight: '700', color: color.bg }}>
              {waiting}
            </ThemedText>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {showSort ? (
          <Pressable
            testID="chats-sort"
            accessibilityRole="button"
            accessibilityLabel="Sort and layout"
            onPress={() => setSheet('sort')}
            hitSlop={8}
            style={({ pressed }) => ({ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <ThemedText variant="title3">⋯</ThemedText>
          </Pressable>
        ) : null}
        {android || !onNewChat ? null : newChat}
      </View>
      {updateBanner}
      {needsYou && needsYou.count > 0 ? (
        <Pressable
          testID="needs-you-banner"
          accessibilityRole="button"
          accessibilityLabel={`${needsYou.count} ${needsYou.count === 1 ? 'approval needs' : 'approvals need'} your yes. ${needsYou.line}`}
          onPress={onNeedsYou}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, backgroundColor: color.fill, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: layout.rowMinHeight + 12, opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ minWidth: 26, height: 26, paddingHorizontal: space.xs, borderRadius: radius.pill, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }}>
            <ThemedText variant="footnote" style={{ fontWeight: '700', color: color.bg }}>
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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: color.fill,
          borderRadius: android ? radius.lg : radius.md - 2,
          paddingHorizontal: space.md,
          height: 38,
          marginTop: space.sm,
          gap: space.sm,
        }}
      >
        <ThemedText variant="body" tone="ink3" accessibilityElementsHidden>
          ⌕
        </ThemedText>
        <TextInput
          testID="chat-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats, settings and actions"
          placeholderTextColor={color.ink3}
          clearButtonMode="while-editing"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search chats"
          style={{
            ...type.body,
            color: color.ink,
            flex: 1,
            height: 38,
            padding: 0,
          }}
        />
      </View>
      {typing || !list.loaded ? null : (
        <FilterChips value={filter} onChange={setFilter} counts={counts} look={look} filterOn={filterOn} onFilter={() => setSheet('filter')} />
      )}
      {showPins ? <PinnedRow pins={pins} onOpen={onOpen} /> : null}
      {showNewTrunk ? (
        <Pressable
          testID="new-trunk-row"
          accessibilityRole="button"
          accessibilityLabel={laterUpdate('New Trunk')}
          disabled
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            marginTop: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: color.line,
          }}
        >
          <View style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' }}>
            <ThemedText variant="title3">+</ThemedText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText variant="headline">New Trunk</ThemedText>
            <ThemedText variant="subhead" tone="ink2">
              {laterUpdate('New Trunk')}
            </ThemedText>
          </View>
        </Pressable>
      ) : null}
      {typing && messages.note ? (
        <ThemedText testID="search-note" variant="footnote" tone="ink3" style={{ marginTop: space.sm }}>
          {messages.note}
        </ThemedText>
      ) : null}
      {online ? null : <OfflineBanner testID="chats-offline" message="Reconnecting to your computer… These chats may be out of date." />}
    </View>
  );

  let empty;
  if (!list.loaded && !list.error) empty = <Skeleton />;
  else if (!list.loaded && list.error)
    empty = online ? (
      <Note testID="chats-error" title="Couldn’t load your chats" body={plainError(list.error)} action={{ title: 'Try again', onPress: () => void refresh() }} />
    ) : (
      <Note testID="chats-waiting" title="Waiting for your computer" body="Your chats show up here as soon as this phone reaches it." />
    );
  else if (typing && messages.searching && items.length === 0) empty = <Note testID="chats-searching" title="Searching…" body="Looking through every chat’s messages." />;
  else if (typing && items.length === 0) empty = <Note testID="chats-no-match" title="No results" body={`No chats or messages match “${query.trim()}”.`} />;
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
          ) : item.kind === 'action' ? (
            <ActionHitView hit={item.action} onRun={(hit) => runAction(hit, handlers)} />
          ) : (
            <ChatRowView row={item.row} now={now} onOpen={onOpen} layout={listLayout} />
          )
        }
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={({ leadingItem }: { leadingItem?: Item }) =>
          leadingItem && leadingItem.kind !== 'header' ? <View style={{ height: layout.hairline, backgroundColor: color.line, marginLeft: layout.screenInset + AVATAR + space.md }} /> : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl + bottomExtra + (android && onNewChat ? 72 : 0) }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.ink3} colors={[color.ink]} />}
      />
      {android && onNewChat ? newChat : null}
      {sheet === 'filter' || sheet === 'filter-status' ? (
        <Sheet title={sheet === 'filter-status' ? 'Status' : 'Filters'} testID="chats-filter-sheet" onClose={() => setSheet(null)}>
          {sheet === 'filter-status' ? (
            <>
              <Pressable testID="filter-status-back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => setSheet('filter')} style={{ minHeight: layout.rowMinHeight, justifyContent: 'center' }}>
                <ThemedText variant="body">‹ Back</ThemedText>
              </Pressable>
              {(['all', 'working', 'waiting', 'idle'] as const).map((id) => (
                <RadioRow
                  key={id}
                  testID={`filter-status-${id}`}
                  label={STATUS_LABEL[id]}
                  selected={status === id}
                  onPress={() => {
                    setStatus(id);
                    setSheet('filter');
                  }}
                />
              ))}
            </>
          ) : (
            <>
              <Pressable
                testID="filter-status"
                accessibilityRole="button"
                accessibilityLabel={`Status, ${STATUS_LABEL[status]}`}
                onPress={() => setSheet('filter-status')}
                style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: layout.rowMinHeight, opacity: pressed ? 0.7 : 1 })}
              >
                <ThemedText variant="body">Status</ThemedText>
                <ThemedText variant="body" tone="ink2">
                  {STATUS_LABEL[status]} ›
                </ThemedText>
              </Pressable>
              <Pressable
                testID="filter-autos"
                accessibilityRole="switch"
                accessibilityState={{ checked: includeAutos }}
                accessibilityLabel="Show automation runs"
                onPress={() => setIncludeAutos((on) => !on)}
                style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: layout.rowMinHeight, opacity: pressed ? 0.7 : 1 })}
              >
                <ThemedText variant="body">Show automation runs</ThemedText>
                <ThemedText variant="body" tone="ink2">
                  {includeAutos ? 'On' : 'Off'}
                </ThemedText>
              </Pressable>
              {levelRank(level) >= 1 ? (
                <View testID="filter-system" style={{ minHeight: layout.rowMinHeight, justifyContent: 'center' }}>
                  <ThemedText variant="body" tone="ink2">
                    {laterUpdate('Show system conversations')}
                  </ThemedText>
                </View>
              ) : null}
            </>
          )}
        </Sheet>
      ) : null}
      {sheet === 'sort' ? (
        <Sheet title="Sort and layout" testID="chats-sort-sheet" onClose={() => setSheet(null)}>
          <RadioRow testID="sort-new" label="Newest first" selected={sort === 'new'} onPress={() => setSort('new')} />
          <RadioRow testID="sort-old" label="Oldest first" selected={sort === 'old'} onPress={() => setSort('old')} />
          <View style={{ height: space.lg }} />
          <RadioRow testID="layout-detailed" label="Detailed" selected={listLayout === 'detailed'} onPress={() => setListLayout('detailed')} />
          <RadioRow testID="layout-compact" label="Compact" selected={listLayout === 'compact'} onPress={() => setListLayout('compact')} />
        </Sheet>
      ) : null}
    </View>
  );
}
