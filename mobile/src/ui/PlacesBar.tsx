import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '../theme/ThemedText';
import { useTheme } from '../theme/ThemeProvider';

export const PLACES = [
  ['home', 'Home'],
  ['chats', 'Chats'],
  ['inbox', 'Inbox'],
  ['more', 'More'],
] as const;

export type Place = (typeof PLACES)[number][0];

const BAR = 64;

/** Android places bar from the preview: Home, Chats, Inbox, More. Inbox can show a count. */
export function PlacesBar({
  current,
  inboxCount = 0,
  onPlace,
}: {
  current: Place;
  inboxCount?: number;
  onPlace: (place: Place) => void;
}) {
  const { color, space, radius, layout } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="places-bar"
      accessibilityRole="tablist"
      accessibilityLabel="Places"
      style={{
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        height: BAR + insets.bottom,
        paddingBottom: insets.bottom,
        flexShrink: 0,
        backgroundColor: color.fill,
        borderTopWidth: layout.hairline,
        borderTopColor: color.line,
      }}
    >
      {PLACES.map(([id, label]) => {
        const on = id === current;
        const count = id === 'inbox' ? inboxCount : 0;
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
              gap: space.xxs,
              opacity: pressed ? 0.7 : 1,
            })}
          >
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
                  testID={`place-inbox-count`}
                  style={{ minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: radius.pill, backgroundColor: on ? color.bg : color.ink, alignItems: 'center', justifyContent: 'center' }}
                >
                  <ThemedText variant="caption2" style={{ color: on ? color.ink : color.bg, fontWeight: '700', lineHeight: 13 }}>
                    {count}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export const placesBarHeight = (bottomInset: number) => BAR + bottomInset;
