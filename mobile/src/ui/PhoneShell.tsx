import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { PlacesBar, type PhoneLook, type Place } from './PlacesBar';

/**
 * The iPhone / Android app frame around a root place: the screen plus the Places bar.
 * Nested screens (a chat, Voice, Take control, pairing) omit the bar, as in phoneFrame.
 */
export function PhoneShell({
  current,
  inboxCount = 0,
  onPlace,
  look = Platform.OS === 'ios' ? 'ios' : 'android',
  children,
  showTabs = true,
}: {
  current: Place;
  inboxCount?: number;
  onPlace: (place: Place) => void;
  look?: PhoneLook;
  children: ReactNode;
  showTabs?: boolean;
}) {
  return (
    <View testID="phone-shell" style={{ flex: 1 }}>
      {children}
      {showTabs ? <PlacesBar current={current} inboxCount={inboxCount} onPlace={onPlace} look={look} /> : null}
    </View>
  );
}
