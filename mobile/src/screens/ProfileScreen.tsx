import { Pressable, View } from 'react-native';
import { STATUS_LABEL, type AgentRow } from '../agents/agentList';
import { laterUpdate, showsLaterUpdates, type ShowLevel } from '../settings/showLevel';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { DetailRow } from '../ui/DetailRow';
import { Card, Screen } from '../ui/Screen';

export type ProfileAction = 'computer';

type RowSpec = {
  id: string;
  label: string;
  detail: string;
  value?: string;
  action?: ProfileAction;
};

/** Preview r50 Profile rows (p50sProfile). Ready rows navigate; the rest wait for Advanced. */
export function profileRows({
  level,
  row,
  computer,
}: {
  level: ShowLevel;
  row: AgentRow;
  computer: string;
}): { id: string; title: string; rows: RowSpec[] }[] {
  const later = showsLaterUpdates(level);
  const computerAndModel: RowSpec[] = [
    { id: 'computer', label: 'Its computer', detail: 'Open the computer pane', value: computer, action: 'computer' },
  ];
  if (later) {
    computerAndModel.push({ id: 'model', label: 'Model', detail: laterUpdate('Model'), value: 'Answers for this Trunk' });
  }
  const may: RowSpec[] = later
    ? [{ id: 'may', label: 'May do', detail: laterUpdate('May do'), value: 'How much this Trunk may do' }]
    : [];
  const remembers: RowSpec[] = later
    ? [{ id: 'library', label: 'Library', detail: laterUpdate('Library'), value: 'What it remembers and keeps' }]
    : [];
  const actions: RowSpec[] = later
    ? [
        { id: 'default', label: `Make ${row.name} the default`, detail: laterUpdate('Make default') },
        { id: 'pause', label: `Pause ${row.name}`, detail: laterUpdate(`Pause ${row.name}`) },
      ]
    : [];
  return [
    { id: 'computer-model', title: 'Computer and model', rows: computerAndModel },
    { id: 'may', title: 'What it may do', rows: may },
    { id: 'remembers', title: 'What it remembers', rows: remembers },
    { id: 'actions', title: 'Actions', rows: actions },
  ].filter((group) => group.rows.length > 0);
}

/** A Trunk’s profile from the Android preview. Every row has a short line saying what it does. */
export function ProfileScreen({
  row,
  level,
  computer,
  onComputer,
  onBack,
  backTo = 'Agents',
}: {
  row: AgentRow;
  level: ShowLevel;
  computer: string;
  onComputer: () => void;
  onBack: () => void;
  backTo?: 'Agents' | 'More';
}) {
  const { color, space, radius, layout } = useTheme();
  const groups = profileRows({ level, row, computer });
  const status = STATUS_LABEL[row.status];

  return (
    <Screen testID="profile-screen">
      <Pressable
        testID="profile-back"
        accessibilityRole="button"
        accessibilityLabel={`Back to ${backTo}`}
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
          {`‹ ${backTo}`}
        </ThemedText>
      </Pressable>
      <View testID="profile-header" style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: radius.pill,
            backgroundColor: color.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ThemedText variant="title1" tone="accentInk">
            {row.avatar}
          </ThemedText>
        </View>
        <ThemedText variant="title2" accessibilityRole="header">
          {row.name}
        </ThemedText>
        <ThemedText variant="subhead" tone="ink2">
          A Trunk on your computer
        </ThemedText>
        <ThemedText testID="profile-status" variant="footnote" tone={row.status === 'running' ? 'ok' : 'ink3'}>
          {status}
        </ThemedText>
      </View>
      {groups.map((group) => (
        <Card key={group.id} testID={`profile-${group.id}`}>
          <ThemedText variant="headline">{group.title}</ThemedText>
          {group.rows.map((item, index) => (
            <DetailRow
              key={item.id}
              testID={`profile-${item.id}`}
              label={item.label}
              detail={item.detail}
              value={item.value}
              last={index === group.rows.length - 1}
              onPress={item.action === 'computer' ? onComputer : undefined}
            />
          ))}
        </Card>
      ))}
    </Screen>
  );
}
