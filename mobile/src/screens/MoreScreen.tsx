import { Pressable } from 'react-native';
import { laterUpdate, showsLaterUpdates, type ShowLevel } from '../settings/showLevel';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { DetailRow } from '../ui/DetailRow';
import { Card, Screen } from '../ui/Screen';

export type MoreAction = 'settings' | 'trunks' | 'you';

type RowSpec = {
  id: string;
  label: string;
  detail: string;
  value?: string;
  action?: MoreAction;
};

/** Preview r50 More rows (p50sMoreHTML). Ready rows navigate; the rest wait for Advanced. */
export function moreRows({
  level,
  trunkCount,
  workingCount,
  youName,
  youRole,
}: {
  level: ShowLevel;
  trunkCount: number;
  workingCount: number;
  youName: string;
  youRole?: string;
}): { id: string; title: string; rows: RowSpec[] }[] {
  const later = showsLaterUpdates(level);
  const you: RowSpec[] = [
    {
      id: 'you',
      label: youName,
      detail: 'Your name, picture and what this phone may do',
      value: youRole || undefined,
      action: 'you',
    },
  ];
  const keepoak: RowSpec[] = later
    ? [{ id: 'signin', label: 'Sign in with KeepOak', detail: laterUpdate('Sign in with KeepOak'), value: 'Your computers and your team, everywhere' }]
    : [];
  const work: RowSpec[] = [];
  if (later) {
    work.push(
      { id: 'canopy', label: 'Canopy', detail: laterUpdate('Canopy'), value: `${workingCount} working now` },
      { id: 'people', label: 'People', detail: laterUpdate('People'), value: 'Your team and what they run' },
      { id: 'automations', label: 'Automations', detail: laterUpdate('Automations'), value: 'Scheduled work and check-ins' },
      { id: 'library', label: 'Library', detail: laterUpdate('Library'), value: 'Memory and documents' },
    );
  }
  work.push({
    id: 'trunks',
    label: 'Trunks',
    detail: 'Each Trunk, its computer and its rules',
    value: String(trunkCount),
    action: 'trunks',
  });
  if (later) {
    work.push({ id: 'usage', label: 'What’s left', detail: laterUpdate('What’s left'), value: '5-hour and weekly limits' });
  }
  const setup: RowSpec[] = [
    { id: 'settings', label: 'Settings', detail: 'Connection, voice, notifications and privacy', action: 'settings' },
  ];
  if (later) {
    setup.push({
      id: 'widgets',
      label: 'Widgets and lock screen',
      detail: laterUpdate('Widgets and lock screen'),
      value: 'Home screen and lock screen pieces',
    });
  }
  return [
    { id: 'person', title: 'You', rows: you },
    { id: 'keepoak', title: 'KeepOak', rows: keepoak },
    { id: 'work', title: 'Work', rows: work },
    { id: 'setup', title: 'Setup', rows: setup },
  ].filter((group) => group.rows.length > 0);
}

/** More: grouped rows from the Android preview. Every row has a short line saying what it does. */
export function MoreScreen({
  level,
  trunkCount,
  workingCount,
  youName,
  youRole,
  onYou,
  onSettings,
  onTrunks,
  onBack,
  bottomExtra = 0,
}: {
  level: ShowLevel;
  trunkCount: number;
  workingCount: number;
  youName: string;
  youRole?: string;
  onYou: () => void;
  onSettings: () => void;
  onTrunks: () => void;
  onBack: () => void;
  /** Extra padding above a floating Places bar. */
  bottomExtra?: number;
}) {
  const { space, layout } = useTheme();
  const groups = moreRows({ level, trunkCount, workingCount, youName, youRole });
  const go = (action?: MoreAction) => {
    if (action === 'you') onYou();
    if (action === 'settings') onSettings();
    if (action === 'trunks') onTrunks();
  };

  return (
    <Screen testID="more-screen" bottomExtra={bottomExtra}>
      <Pressable
        testID="more-back"
        accessibilityRole="button"
        accessibilityLabel="Back to Chats"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: layout.rowMinHeight,
          justifyContent: 'center',
          marginTop: -space.xl,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <ThemedText variant="body" tone="accentInk">
          ‹ Chats
        </ThemedText>
      </Pressable>
      <ThemedText variant="largeTitle" accessibilityRole="header">
        More
      </ThemedText>
      {groups.map((group) => (
        <Card key={group.id} testID={`more-${group.id}`}>
          <ThemedText variant="headline">{group.title}</ThemedText>
          {group.rows.map((row, index) => (
            <DetailRow
              key={row.id}
              testID={`more-${row.id}`}
              label={row.label}
              detail={row.detail}
              value={row.value}
              last={index === group.rows.length - 1}
              onPress={row.action ? () => go(row.action) : undefined}
            />
          ))}
        </Card>
      ))}
    </Screen>
  );
}
