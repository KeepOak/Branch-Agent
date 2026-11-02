import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComputerRow } from '../computers/computerList';
import type { EngineLink } from '../pairing/pairingSession';
import { BrowserPane, type BrowserPhase } from '../stage/BrowserPane';
import { DriveSurface } from '../stage/DriveSurface';
import { bw } from '../stage/bw';
import { useHoldTarget } from '../stage/hold-session';
import type { KeyValueStore } from '../storage/keyValueStore';
import { restoreTouchMode, setTouchMode, useTouchMode } from '../stage/touch-mode';
import { useNativeScreen } from '../stage/useNativeScreen';
import { useTrunkHold } from '../stage/trunk-hold';
import { layout, space, type } from '../theme/tokens';

export type StagePane = 'computer' | 'browser';

/** Full-screen take-control: Computer or Browser, Touch or Trackpad, Take over and Hand back. Black and white. */
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
  const [pane, setPane] = useState<StagePane>('computer');
  const [control, setControl] = useState(false);
  const [retry, setRetry] = useState(0);
  const [browserPhase, setBrowserPhase] = useState<BrowserPhase>('loading');
  const target = useHoldTarget(link);
  const screen = useNativeScreen(link, control && pane === 'computer', newId, retry, pane === 'computer');
  const hold = useTrunkHold(link, control, target?.sessionKey ?? null);

  useEffect(() => {
    if (store) void restoreTouchMode(store);
  }, [store]);

  const choose = (next: 'touch' | 'trackpad') => {
    setTouchMode(next, store);
  };

  const show = (next: StagePane) => {
    setControl(false);
    setPane(next);
  };

  const name = target?.name;
  const driving = hold.paused && name ? `You’re driving · ${name} is paused` : 'You’re driving';
  const handBack = name ? `Hand back to ${name}` : 'Hand back';
  const computerReady = Boolean(screen.image);
  const browserReady = browserPhase === 'connected';
  const ready = pane === 'computer' ? computerReady : browserReady;
  const pill = control ? 'You' : pane === 'browser' ? (browserReady ? 'Live' : 'Idle') : screen.image ? 'Live' : 'Idle';
  const backGlyph = Platform.OS === 'ios' ? '‹' : '←';
  const title = pane === 'browser' ? (name ? `${name}’s browser` : 'Browser') : computer.name;
  const overlay = <ModePill mode={mode} onChoose={choose} />;

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
            {title}
          </Text>
          <Text numberOfLines={1} style={{ ...type.caption1, color: bw.ink2 }}>
            {control ? driving : 'Look only'}
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
        testID="stage-pane-switch"
        accessibilityRole="tablist"
        accessibilityLabel="Show"
        style={{
          alignSelf: 'center',
          marginBottom: space.sm,
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: bw.line,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <PaneTab label="Computer" selected={pane === 'computer'} onPress={() => show('computer')} testID="stage-pane-computer" />
        <PaneTab label="Browser" selected={pane === 'browser'} onPress={() => show('browser')} testID="stage-pane-browser" />
      </View>

      {hold.error ? (
        <Text testID="take-control-hold-error" accessibilityRole="alert" style={{ ...type.footnote, color: bw.ink, textAlign: 'center', paddingHorizontal: layout.screenInset, paddingBottom: space.sm }}>
          {hold.error}
        </Text>
      ) : null}

      {pane === 'browser' ? (
        <BrowserPane link={link} sessionKey={target?.sessionKey ?? null} control={control} onControl={setControl} onPhase={setBrowserPhase} overlay={overlay} />
      ) : (
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
          {overlay}
        </View>
      )}

      {screen.inputNote && pane === 'computer' ? (
        <Text testID="take-control-input-note" accessibilityRole="alert" style={{ ...type.footnote, color: bw.ink, textAlign: 'center', paddingHorizontal: layout.screenInset, paddingTop: space.sm }}>
          {screen.inputNote}
        </Text>
      ) : null}

      <View style={{ paddingHorizontal: layout.screenInset, paddingTop: space.md, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>
        {control ? (
          <Pressable
            testID="hand-back"
            accessibilityRole="button"
            accessibilityLabel={handBack}
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
            <Text style={{ ...type.headline, color: bw.onInk }}>{handBack}</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="take-over"
            accessibilityRole="button"
            accessibilityLabel="Take over"
            disabled={!ready}
            onPress={() => setControl(true)}
            style={({ pressed }) => ({
              minHeight: layout.rowMinHeight + 6,
              borderRadius: 14,
              backgroundColor: ready ? bw.ink : bw.fill,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !ready ? 0.45 : pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...type.headline, color: ready ? bw.onInk : bw.ink3 }}>Take over</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function PaneTab({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: space.lg,
        backgroundColor: selected ? bw.ink : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ ...type.subhead, color: selected ? bw.onInk : bw.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function ModePill({ mode, onChoose }: { mode: 'touch' | 'trackpad'; onChoose: (next: 'touch' | 'trackpad') => void }) {
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center', zIndex: 4 }}>
      <View
        testID="touch-mode-switch"
        accessibilityRole="tablist"
        accessibilityLabel="On a touch screen"
        style={{
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: bw.line,
          borderRadius: 999,
          backgroundColor: bw.raise,
          overflow: 'hidden',
        }}
      >
        <ModeChip label="Touch" selected={mode === 'touch'} onPress={() => onChoose('touch')} testID="touch-mode-touch" hint="The screen follows your finger" />
        <ModeChip label="Trackpad" selected={mode === 'trackpad'} onPress={() => onChoose('trackpad')} testID="touch-mode-trackpad" hint="Move the pointer, tap to click" />
      </View>
    </View>
  );
}

function ModeChip({
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 32,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        backgroundColor: selected ? bw.ink : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ ...type.caption1, color: selected ? bw.onInk : bw.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
