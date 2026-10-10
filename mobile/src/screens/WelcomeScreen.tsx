import { View } from 'react-native';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';

const STEPS = [
  'On your computer, open Branch and choose Get the apps, then Pair a phone.',
  'Scan the code it shows with this phone.',
  'Choose Allow when Branch on your computer asks about this phone. That’s it.',
];

/** First launch: what Branch on the phone is, how pairing works, and one way forward. */
export function WelcomeScreen({ onPair }: { onPair: () => void }) {
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
      <ThemedText variant="largeTitle" accessibilityRole="header">
        Branch
      </ThemedText>
      <ThemedText variant="body" tone="ink2" style={{ marginTop: space.xs }}>
        Your Trunks and Branch Agent, in your pocket.
      </ThemedText>
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
    </Screen>
  );
}
