import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComputerRow } from '../computers/computerList';
import type { EngineLink } from '../pairing/pairingSession';
import { DriveSurface } from '../stage/DriveSurface';
import { bw } from '../stage/bw';
import type { KeyValueStore } from '../storage/keyValueStore';
import { restoreTouchMode, setTouchMode, useTouchMode } from '../stage/touch-mode';
import { useNativeScreen } from '../stage/useNativeScreen';
import { layout, space, type } from '../theme/tokens';

/** Full-screen take-control: the live picture, Touch or Trackpad, Take over and Hand back. Black and white. */
export function TakeControlScreen({
  computer,
  link,
  newId,
  store,
  onBack,
}: {
  computer: ComputerRow;
  link: EngineLink;
  newId: () => string;
  store?: KeyValueStore;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const mode = useTouchMode();
  const [control, setControl] = useState(false);
  const [retry, setRetry] = useState(0);
  const screen = useNativeScreen(link, control, newId, retry);

  useEffect(() => {
    if (store) void restoreTouchMode(store);
  }, [store]);

  const choose = (next: 'touch' | 'trackpad') => {
    setTouchMode(next, store);
  };

  const pill = control ? 'You' : screen.image ? 'Live' : 'Idle';
  const backGlyph = Platform.OS === 'ios' ? '‹' : '←';

  return (
    <View testID="take-control-screen" style={{ flex: 1, backgroundColor: bw.bg }}>
      <View
        style={{
          paddingTop: insets.top + space.xs,
          paddingHorizontal: layout.screenInset,
          paddingBottom: space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        }}
      >
        <Pressable
          testID="take-control-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Computers"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ minHeight: layout.rowMinHeight, minWidth: layout.rowMinHeight, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ ...type.body, color: bw.ink }}>{backGlyph} Computers</Text>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ ...type.headline, color: bw.ink }}>
            {computer.name}
          </Text>
          <Text numberOfLines={1} style={{ ...type.caption1, color: bw.ink2 }}>
            {control ? 'You’re driving' : 'Look only'}
          </Text>
        </View>
        <View
          testID="take-control-pill"
          style={{ paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: 999, backgroundColor: bw.fill, borderWidth: 1, borderColor: bw.line }}
        >
          <Text style={{ ...type.caption1, color: bw.ink, fontWeight: '600' }}>{pill}</Text>
        </View>
      </View>

      <View
        testID="touch-mode-switch"
        accessibilityRole="tablist"
        accessibilityLabel="On a touch screen"
        style={{
          marginHorizontal: layout.screenInset,
          marginBottom: space.sm,
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: bw.line,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <ModeTab label="Touch" hint="Tap to click" fullHint="Tap where you want to click" selected={mode === 'touch'} onPress={() => choose('touch')} testID="touch-mode-touch" />
        <ModeTab label="Trackpad" hint="Move the pointer" fullHint="Move the pointer with one finger, tap to click" selected={mode === 'trackpad'} onPress={() => choose('trackpad')} testID="touch-mode-trackpad" />
      </View>

      <View style={{ flex: 1, marginHorizontal: layout.screenInset, borderWidth: 1, borderColor: bw.line, borderRadius: 12, overflow: 'hidden' }}>
        <DriveSurface active={control} frame={screen.frame} remote={screen.remote} send={screen.send} typingLabel="Type on this computer">
          {screen.image ? (
            <Image testID="take-control-picture" source={{ uri: screen.image }} resizeMode="contain" style={{ flex: 1, width: '100%', height: '100%', backgroundColor: bw.bg }} accessibilityLabel="Live screen of this computer" />
          ) : (
            <View testID={screen.problem ? 'take-control-problem' : 'take-control-connecting'} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>
              <Text style={{ ...type.body, color: bw.ink, textAlign: 'center' }}>{screen.problem ? screen.problem.line : 'Connecting…'}</Text>
              {screen.problem?.retry ? (
                <Pressable
                  testID="take-control-retry"
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  onPress={() => setRetry((value) => value + 1)}
                  style={({ pressed }) => ({
                    minHeight: layout.rowMinHeight,
                    paddingHorizontal: space.lg,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: bw.ink,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ ...type.headline, color: bw.ink }}>Try again</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </DriveSurface>
      </View>

      {screen.inputNote ? (
        <Text testID="take-control-input-note" accessibilityRole="alert" style={{ ...type.footnote, color: bw.ink, textAlign: 'center', paddingHorizontal: layout.screenInset, paddingTop: space.sm }}>
          {screen.inputNote}
        </Text>
      ) : null}

      <View style={{ paddingHorizontal: layout.screenInset, paddingTop: space.md, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>
        {control ? (
          <Pressable
            testID="hand-back"
            accessibilityRole="button"
            accessibilityLabel="Hand back"
            onPress={() => setControl(false)}
            style={({ pressed }) => ({
              minHeight: layout.rowMinHeight + 6,
              borderRadius: 14,
              backgroundColor: bw.ink,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...type.headline, color: bw.onInk }}>Hand back</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="take-over"
            accessibilityRole="button"
            accessibilityLabel="Take over"
            disabled={!screen.image}
            onPress={() => setControl(true)}
            style={({ pressed }) => ({
              minHeight: layout.rowMinHeight + 6,
              borderRadius: 14,
              backgroundColor: screen.image ? bw.ink : bw.fill,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !screen.image ? 0.45 : pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...type.headline, color: screen.image ? bw.onInk : bw.ink3 }}>Take over</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ModeTab({
  label,
  hint,
  fullHint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint: string;
  fullHint: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${fullHint}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: layout.rowMinHeight,
        paddingVertical: space.sm,
        paddingHorizontal: space.sm,
        backgroundColor: selected ? bw.ink : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ ...type.headline, color: selected ? bw.onInk : bw.ink }}>{label}</Text>
      <Text numberOfLines={1} style={{ ...type.caption2, color: selected ? bw.onInk : bw.ink3 }}>
        {hint}
      </Text>
    </Pressable>
  );
}
