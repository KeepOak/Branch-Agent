import { render, screen } from '@testing-library/react-native';
import { PairingTheme, ThemeProvider } from '../theme/ThemeProvider';
import { ScanScreen } from './ScanScreen';

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn()],
}));

describe('ScanScreen camera granted', () => {
  it('shows granted camera copy and Scan the code, not Branch needs the camera', async () => {
    await render(
      <ThemeProvider scheme="light">
        <PairingTheme>
          <ScanScreen onCode={() => undefined} onEnterCode={() => undefined} />
        </PairingTheme>
      </ThemeProvider>,
    );
    expect(screen.getByText('The camera is on for Branch')).toBeOnTheScreen();
    expect(screen.getByText(/Point it at the square code on your computer/)).toBeOnTheScreen();
    expect(screen.queryByText('Branch needs the camera')).toBeNull();
    expect(screen.getByRole('button', { name: 'Scan the code' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Look again' })).toBeDisabled();
  });
});
