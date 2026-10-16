import type { ReactNode } from 'react';
import { Image, View } from 'react-native';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';
import { KEEPOAK_SIGN_IN, laterUpdate, type SettingsLevel } from './settingsExtras';

const PROMISE = [
  'Your Trunks run on your own computer.',
  'Connect this phone by scanning a code.',
  'Chat, talk and answer from anywhere.',
];

const STEPS = [
  'On your computer, open Branch and choose Get the apps, then Pair a phone.',
  'Scan the square code it shows with this phone, or type the code.',
  'Choose Allow when Branch on your computer asks about this phone. That’s it.',
];

export const KEEPOAK_SIGN_IN_LATER = laterUpdate(KEEPOAK_SIGN_IN);

/** First launch: one pairing flow (scan or type, then trust, then paired). KeepOak sign-in is not faked. */
export function WelcomeScreen({
  onPair,
  updateBanner,
  level = 0,
}: {
  onPair: () => void;
  updateBanner?: ReactNode;
  level?: SettingsLevel;
}) {
  const { color, space, radius } = useTheme();
  return (
    <Screen
      testID="welcome-screen"
      footer={
        <>
          <Button title="Pair with your computer" onPress={onPair} testID="pair-button" />
          <ThemedText variant="footnote" tone="ink3" style={{ textAlign: 'center', marginTop: space.xs }}>
            Talks only to your own computer. No passwords, no keys.
          </ThemedText>
        </>
      }
    >
      <View style={{ alignItems: 'center' }}>
        <Image source={require('../../assets/icon.png')} accessibilityIgnoresInvertColors style={{ width: 72, height: 72, borderRadius: radius.lg }} />
        <ThemedText variant="largeTitle" accessibilityRole="header" style={{ marginTop: space.md, textAlign: 'center' }}>
          Branch
        </ThemedText>
        <ThemedText variant="body" tone="ink2" style={{ marginTop: space.xs, textAlign: 'center' }}>
          Your Trunks, in your pocket.
        </ThemedText>
      </View>
      {updateBanner}
      <View testID="pairing-promise" style={{ marginTop: space.xxl, gap: space.md }}>
        {PROMISE.map((line) => (
          <ThemedText key={line} variant="subhead" tone="ink2">
            {line}
          </ThemedText>
        ))}
      </View>
      <Card testID="pairing-steps">
        <ThemedText variant="headline">How pairing works</ThemedText>
        {STEPS.map((step, index) => (
          <View key={step} style={{ flexDirection: 'row', marginTop: space.md }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: radius.pill,
                backgroundColor: color.accentTint,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: space.md,
              }}
            >
              <ThemedText variant="footnote" tone="accentInk" style={{ fontWeight: '600' }}>
                {index + 1}
              </ThemedText>
            </View>
            <ThemedText variant="subhead" tone="ink2" style={{ flex: 1 }}>
              {step}
            </ThemedText>
          </View>
        ))}
      </Card>
      {level >= 1 ? (
        <ThemedText testID="keepoak-later" variant="footnote" tone="ink3" style={{ marginTop: space.xxl, textAlign: 'center' }}>
          {KEEPOAK_SIGN_IN_LATER}
        </ThemedText>
      ) : null}
    </Screen>
  );
}
