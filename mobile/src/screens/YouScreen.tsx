import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { accessLine, initials, youRows, type SelfProfile } from '../people/self';
import type { ShowLevel } from '../settings/showLevel';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { DetailRow } from '../ui/DetailRow';
import { Card, Screen } from '../ui/Screen';

/** Preview People › you (youSecPE18 / MineHead): name, face, access, this Branch. */
export function YouScreen({
  self,
  level,
  scopes,
  computer,
  computerStatus,
  onComputer,
  onBack,
  onRename,
  backTo = 'More',
}: {
  self: SelfProfile;
  level: ShowLevel;
  scopes: readonly string[];
  computer: string;
  computerStatus: string;
  onComputer: () => void;
  onBack: () => void;
  onRename?: (name: string) => Promise<void>;
  backTo?: 'More' | 'Home';
}) {
  const { color, space, radius, layout } = useTheme();
  const groups = youRows({
    level,
    self,
    access: accessLine(scopes),
    computer,
    computerStatus,
    scopes,
  });
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const draft = edit?.trim() ?? '';
  const canRename = Boolean(onRename && self.id);
  const save = async () => {
    if (!onRename || !self.id || !draft || draft === self.name) {
      setEdit(null);
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      await onRename(draft);
      setEdit(null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Couldn’t save your name.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="you-screen">
      <Pressable
        testID="you-back"
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
      <View testID="you-header" style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
        <View
          accessibilityRole="image"
          accessibilityLabel={self.name}
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            backgroundColor: color.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ThemedText variant="title2" tone="accentInk">
            {initials(self.name)}
          </ThemedText>
        </View>
        {edit === null ? (
          <>
            <ThemedText testID="you-name" variant="title2" accessibilityRole="header">
              {self.name}
            </ThemedText>
            {canRename ? (
              <Button title="Change" kind="plain" onPress={() => setEdit(self.name)} testID="you-name-change" />
            ) : self.id ? null : (
              <ThemedText testID="you-name-disabled" variant="footnote" tone="ink3">
                Changing your name needs a signed-in profile.
              </ThemedText>
            )}
          </>
        ) : (
          <View style={{ alignSelf: 'stretch', gap: space.sm }}>
            <TextInput
              testID="you-name-input"
              value={edit}
              onChangeText={setEdit}
              maxLength={256}
              autoFocus
              accessibilityLabel="Your name"
              onSubmitEditing={() => void save()}
              style={{
                minHeight: layout.rowMinHeight,
                borderRadius: radius.sm,
                borderWidth: layout.hairline,
                borderColor: color.line,
                paddingHorizontal: space.md,
                color: color.ink,
                backgroundColor: color.raise,
              }}
            />
            <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'center' }}>
              <Button title="Save" kind="primary" disabled={!draft || draft === self.name} busy={busy} onPress={() => void save()} testID="you-name-save" />
              <Button title="Cancel" kind="plain" onPress={() => { setEdit(null); setFailed(null); }} testID="you-name-cancel" />
            </View>
          </View>
        )}
        {self.role ? (
          <ThemedText testID="you-role" variant="footnote" tone={self.owner ? 'ok' : 'ink3'}>
            {self.role}
          </ThemedText>
        ) : null}
        {failed ? (
          <ThemedText testID="you-name-error" variant="footnote" tone="bad">
            {failed}
          </ThemedText>
        ) : null}
      </View>
      {groups.map((group) => (
        <Card key={group.id} testID={`you-${group.id}`}>
          <ThemedText variant="headline">{group.title}</ThemedText>
          {group.rows.map((item, index) => (
            <DetailRow
              key={item.id}
              testID={`you-${item.id}`}
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
