import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';

/** Preview PH_TABS: Home, Chats, Inbox, More. */
export const PLACES = [
  ['home', 'Home'],
  ['chats', 'Chats'],
  ['inbox', 'Inbox'],
  ['more', 'More'],
] as const;

export type Place = (typeof PLACES)[number][0];
export type PhoneLook = 'ios' | 'android';

const BAR = 64;
const IOS_BOTTOM = 24;
const IOS_SIDE = 14;
/** Preview .p-status height on iPhone. The device draws the clock in that band. */
export const IOS_STATUS = 50;

/** Preview .p-tabs: iOS is a 64pt floating pill; Android is a flush Material bar. */
export function placesBarHeight(look: PhoneLook, bottomInset: number): number {
  if (look === 'ios') return BAR + Math.max(IOS_BOTTOM, bottomInset + 8);
  return BAR + bottomInset;
}

/** Preview .p-status: 50pt on iPhone, otherwise the device inset. */
export function statusBandHeight(look: PhoneLook, topInset: number): number {
  if (look === 'ios') return Math.max(topInset, IOS_STATUS);
  return topInset;
}

function PlaceMark({ id, on, color }: { id: Place; on: boolean; color: string }) {
  if (id === 'home') {
    return (
      <View style={{ width: 18, height: 16, alignItems: 'center', justifyContent: 'flex-end' }}>
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 8,
            borderRightWidth: 8,
            borderBottomWidth: 7,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: color,
          }}
        />
        <View style={{ width: 12, height: 8, backgroundColor: color, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
      </View>
    );
  }
  if (id === 'chats') {
    return (
      <View
        style={{
          width: 18,
          height: 14,
          borderRadius: 5,
          borderWidth: 1.5,
          borderColor: color,
          backgroundColor: on ? color : 'transparent',
        }}
      />
    );
  }
  if (id === 'inbox') {
    return (
      <View style={{ width: 18, height: 14, borderRadius: 3, borderWidth: 1.5, borderColor: color, justifyContent: 'flex-start' }}>
        <View style={{ height: 4, borderBottomWidth: 1.5, borderBottomColor: color }} />
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 3, height: 14, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: color }} />
      ))}
    </View>
  );
}

/**
 * The preview's Places nav (Home / Chats / Inbox / More). iOS is the floating pill
 * (left/right 14, bottom 24, height 64, radius 32). Android is the flush bar.
 * Selected is ink, never a blue accent: the phone is black and white by default.
 */
export function PlacesBar({
  current,
  inboxCount = 0,
  onPlace,
  look = Platform.OS === 'ios' ? 'ios' : 'android',
}: {
  current: Place;
  inboxCount?: number;
  onPlace: (place: Place) => void;
  look?: PhoneLook;
}) {
  const { color, space, radius, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const ios = look === 'ios';
  const bottom = ios ? Math.max(IOS_BOTTOM, insets.bottom + 8) : insets.bottom;

  return (
    <View
      testID="places-bar"
      accessibilityRole="tablist"
      accessibilityLabel="Places"
      style={
        ios
          ? {
              position: 'absolute',
              left: IOS_SIDE,
              right: IOS_SIDE,
              bottom,
              height: BAR,
              flexDirection: 'row',
              justifyContent: 'space-around',
              alignItems: 'center',
              borderRadius: 32,
              backgroundColor: color.glass,
              borderWidth: layout.hairline,
              borderColor: color.line,
              zIndex: 4,
              shadowColor: color.camera,
              shadowOpacity: 0.18,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
              ...(Platform.OS === 'web'
                ? {
                    backdropFilter: 'blur(20px) saturate(1.6)',
                    WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
                  }
                : null),
            }
          : {
              flexDirection: 'row',
              justifyContent: 'space-around',
              alignItems: 'center',
              height: BAR + insets.bottom,
              paddingBottom: insets.bottom,
              flexShrink: 0,
              backgroundColor: color.fill,
              borderTopWidth: layout.hairline,
              borderTopColor: color.line,
            }
      }
    >
      {PLACES.map(([id, label]) => {
        const on = id === current;
        const count = id === 'inbox' ? inboxCount : 0;
        const mark = on ? color.ink : color.ink3;
        return (
          <Pressable
            key={id}
            testID={`place-${id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={count ? `${label}, ${count} waiting` : label}
            onPress={() => onPlace(id)}
            style={({ pressed }) => ({
              minWidth: 64,
              minHeight: layout.rowMinHeight,
              alignItems: 'center',
              justifyContent: 'center',
              gap: ios ? 2 : space.xxs,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {ios ? (
              <View testID={`place-mark-${id}`} style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
                <PlaceMark id={id} on={on} color={mark} />
                {count ? (
                  <View
                    testID="place-inbox-count"
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -10,
                      minWidth: 16,
                      height: 16,
                      paddingHorizontal: 4,
                      borderRadius: radius.pill,
                      backgroundColor: color.ink,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ThemedText variant="caption2" style={{ color: color.bg, fontWeight: '700', lineHeight: 13 }}>
                      {count}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            ) : (
              <View
                style={{
                  minWidth: 56,
                  height: 30,
                  paddingHorizontal: space.sm,
                  borderRadius: 15,
                  backgroundColor: on ? color.ink : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: space.xs,
                }}
              >
                <ThemedText variant="caption1" style={{ color: on ? color.bg : color.ink2, fontWeight: '600' }}>
                  {label}
                </ThemedText>
                {count ? (
                  <View
                    testID="place-inbox-count"
                    style={{
                      minWidth: 16,
                      height: 16,
                      paddingHorizontal: 4,
                      borderRadius: radius.pill,
                      backgroundColor: on ? color.bg : color.ink,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ThemedText variant="caption2" style={{ color: on ? color.ink : color.bg, fontWeight: '700', lineHeight: 13 }}>
                      {count}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            )}
            {ios ? (
              <ThemedText variant="caption2" style={{ color: on ? color.ink : color.ink3, fontWeight: on ? '600' : '400', fontSize: 10.5 }}>
                {label}
              </ThemedText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
