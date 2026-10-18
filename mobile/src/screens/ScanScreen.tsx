import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listNearbyBranches, NEARBY_NONE } from '../pairing/nearbyBranches';
import { decodeSetupCode, SetupCodeError, type SetupPayload } from '../pairing/setupCode';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Card, Screen } from '../ui/Screen';
import { KEEPOAK_SIGN_IN, laterUpdate } from './settingsExtras';
import { PairingCodeField } from './pairingFields';

export const KEEPOAK_SIGN_IN_LATER = laterUpdate(KEEPOAK_SIGN_IN);
export const LOOK_AGAIN_LATER = laterUpdate('Look again');

const TRUST =
  'A Trunk on the Branch you connect to can use what you allow on this phone: camera, microphone, photos, contacts, calendar and location. Connect only to a Branch you trust.';

export function setupCodeProblem(error: unknown): string {
  const kind = error instanceof SetupCodeError ? error.kind : 'invalid';
  if (kind === 'expired') return 'This code has expired. Make a new one on your computer.';
  if (kind === 'damaged') return 'This code looks damaged. Copy it again from Branch on your computer.';
  return 'That isn’t a Branch pairing code. Use the code from Pair a phone in Branch on your computer.';
}

type CameraPermission = { granted: boolean; canAskAgain: boolean } | null | undefined;

/** Card copy for the three camera states: blocked, granted, or not asked yet. */
export function cameraCardCopy(permission: CameraPermission): { heading: string; body: string } {
  if (permission != null && !permission.granted && !permission.canAskAgain) {
    return {
      heading: 'The camera is off for Branch',
      body: 'Turn on the camera for Branch in Settings, or type the code your computer shows.',
    };
  }
  if (permission?.granted) {
    return {
      heading: 'The camera is on for Branch',
      body: 'Point it at the square code on your computer. Nothing is recorded or kept.',
    };
  }
  return {
    heading: 'Branch needs the camera',
    body: 'It reads the pairing code on your computer’s screen. Nothing is recorded or kept.',
  };
}

function NearbyCard() {
  const { space } = useTheme();
  const found = listNearbyBranches();
  return (
    <Card testID="pairing-nearby">
      <ThemedText variant="headline">Nearby</ThemedText>
      {found.length ? (
        found.map((hit) => (
          <ThemedText key={hit.id} variant="subhead" tone="ink2" style={{ marginTop: space.sm }}>
            {hit.name}
          </ThemedText>
        ))
      ) : (
        <ThemedText testID="nearby-status" variant="subhead" tone="ink2" style={{ marginTop: space.sm }}>
          {NEARBY_NONE}
        </ThemedText>
      )}
      <View style={{ marginTop: space.md }}>
        <Button title="Look again" kind="secondary" disabled onPress={() => undefined} testID="look-again" />
        <ThemedText testID="look-again-reason" variant="footnote" tone="ink3" style={{ marginTop: space.xs, textAlign: 'center' }}>
          {LOOK_AGAIN_LATER}
        </ThemedText>
      </View>
    </Card>
  );
}

/** Full-screen camera that reads the pairing QR code; the code can also be typed on this screen. */
export function ScanScreen({
  onCode,
  onEnterCode,
  onCancel,
  updateBanner,
}: {
  onCode: (setup: SetupPayload) => void;
  onEnterCode: () => void;
  onCancel?: () => void;
  updateBanner?: ReactNode;
}) {
  const { color, space, layout, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [text, setText] = useState('');
  const lastScan = useRef<string | null>(null);

  const read = (raw: string) => {
    try {
      onCode(decodeSetupCode(raw));
    } catch (error) {
      setProblem(setupCodeProblem(error));
    }
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (data === lastScan.current) return;
    lastScan.current = data;
    read(data);
  };

  const submitCode = () => {
    if (!text.trim()) return;
    read(text);
  };

  const startScan = () => {
    if (permission?.granted) {
      setScanning(true);
      return;
    }
    void requestPermission().then((next) => {
      if (next?.granted) setScanning(true);
    });
  };

  if (permission?.granted && scanning) {
    return (
      <View testID="scan-screen" style={[styles.fill, { backgroundColor: color.camera }]}>
        <StatusBar style="light" />
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
        <View style={[styles.fill, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg, paddingHorizontal: layout.screenInset }]}>
          <Pressable accessibilityRole="button" onPress={() => setScanning(false)} hitSlop={12} style={{ alignSelf: 'flex-start', minHeight: layout.rowMinHeight, justifyContent: 'center' }}>
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
              <View
                testID="scan-problem"
                style={{
                  marginTop: space.md,
                  backgroundColor: color.fill,
                  borderColor: color.line,
                  borderWidth: layout.hairline,
                  borderRadius: radius.md,
                  padding: space.md,
                }}
              >
                <ThemedText variant="subhead" tone="ink">
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

  const blocked = permission != null && !permission.granted && !permission.canAskAgain;
  const camera = cameraCardCopy(permission);
  return (
    <Screen
      testID="camera-permission"
      avoidKeyboard
      footer={
        <>
          <Button title="Connect" onPress={submitCode} disabled={!text.trim()} testID="submit-code" />
          {permission === null ? null : blocked ? (
            <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button title={permission.granted ? 'Scan the code' : 'Allow camera'} onPress={startScan} testID="allow-camera" />
          )}
          <Button title="Enter the code instead" kind="secondary" onPress={onEnterCode} testID="enter-code" />
          {onCancel ? <Button title="Back" kind="plain" onPress={onCancel} testID="scan-back" /> : null}
        </>
      }
    >
      <View style={{ alignItems: 'center' }}>
        <Image source={require('../../assets/icon.png')} accessibilityIgnoresInvertColors style={{ width: 72, height: 72, borderRadius: radius.lg }} />
      </View>
      <ThemedText variant="largeTitle" accessibilityRole="header" style={{ marginTop: space.md, textAlign: 'center' }}>
        Connect to your Branch
      </ThemedText>
      <ThemedText variant="body" tone="ink2" style={{ marginTop: space.xs, textAlign: 'center' }}>
        Scan the square code on the computer, or type the code.
      </ThemedText>
      {updateBanner}
      <Card testID="keepoak-later">
        <ThemedText variant="headline">{KEEPOAK_SIGN_IN}</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          {KEEPOAK_SIGN_IN_LATER}
        </ThemedText>
      </Card>
      <Card testID="camera-card">
        <ThemedText variant="headline">{camera.heading}</ThemedText>
        <ThemedText variant="subhead" tone="ink2" style={{ marginTop: space.xs }}>
          {camera.body}
        </ThemedText>
      </Card>
      <Card testID="connect-code">
        <PairingCodeField
          value={text}
          onChange={(value) => {
            setText(value);
            setProblem(null);
          }}
          problem={problem}
          onSubmit={submitCode}
        />
      </Card>
      <NearbyCard />
      <Card testID="pairing-trust">
        <ThemedText variant="subhead" tone="ink2">
          {TRUST}
        </ThemedText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
