import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { decodeSetupCode, SetupCodeError, type SetupPayload } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';

export function setupCodeProblem(error: unknown): string {
  const kind = error instanceof SetupCodeError ? error.kind : 'invalid';
  if (kind === 'expired') return 'This code has expired. Make a new one on your computer.';
  if (kind === 'damaged') return 'This code looks damaged. Copy it again from Branch on your computer.';
  return 'That isn’t a Branch pairing code. Use the code from Pair a phone in Branch on your computer.';
}

/** Full-screen camera that reads the pairing QR code; the code can also be typed. */
export function ScanScreen({
  onCode,
  onEnterCode,
  onCancel,
}: {
  onCode: (setup: SetupPayload) => void;
  onEnterCode: () => void;
  onCancel: () => void;
}) {
  const { color, space, layout, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);
  const lastScan = useRef<string | null>(null);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (data === lastScan.current) return;
    lastScan.current = data;
    try {
      onCode(decodeSetupCode(data));
    } catch (error) {
      setProblem(setupCodeProblem(error));
    }
  };

  if (!permission?.granted) {
    const blocked = permission !== null && !permission.canAskAgain;
    return (
      <Screen
        testID="camera-permission"
        footer={
          <>
            {permission === null ? null : blocked ? (
              <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
            ) : (
              <Button title="Allow camera" onPress={() => void requestPermission()} testID="allow-camera" />
            )}
            <Button title="Enter the code instead" kind="secondary" onPress={onEnterCode} testID="enter-code" />
            <Button title="Cancel" kind="plain" onPress={onCancel} />
          </>
        }
      >
        <ThemedText variant="largeTitle" accessibilityRole="header">
          Scan the code
        </ThemedText>
        <Card>
          <ThemedText variant="headline">{blocked ? 'The camera is off for Branch' : 'Branch needs the camera'}</ThemedText>
          <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
            {blocked
              ? 'Turn on the camera for Branch in Settings, or type the code your computer shows.'
              : 'It reads the pairing code on your computer’s screen. Nothing is recorded or kept.'}
          </ThemedText>
        </Card>
      </Screen>
    );
  }

  return (
    <View testID="scan-screen" style={[styles.fill, { backgroundColor: color.camera }]}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
      <View style={[styles.fill, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg, paddingHorizontal: layout.screenInset }]}>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12} style={{ alignSelf: 'flex-start', minHeight: layout.rowMinHeight, justifyContent: 'center' }}>
          <ThemedText variant="headline" tone="onAccent">
            Cancel
          </ThemedText>
        </Pressable>
        <View style={styles.center}>
          <View style={{ width: 240, height: 240, borderRadius: radius.lg + 8, borderWidth: 3, borderColor: color.onAccent }} />
          <ThemedText variant="headline" tone="onAccent" style={{ marginTop: space.xl, textAlign: 'center' }}>
            Point at the code in Branch on your computer
          </ThemedText>
          {problem ? (
            <View style={{ marginTop: space.md, backgroundColor: color.badTint, borderRadius: radius.md, padding: space.md }}>
              <ThemedText variant="subhead" tone="bad">
                {problem}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <Button title="Enter the code instead" kind="secondary" onPress={onEnterCode} testID="enter-code" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
