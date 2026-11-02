import { FlatList, ScrollView, SectionList, type FlatListProps, type ScrollViewProps, type SectionListProps } from 'react-native';

/** Forced off so a caller cannot turn indicators back on. */
const HIDE_INDICATORS = {
  showsVerticalScrollIndicator: false,
  showsHorizontalScrollIndicator: false,
} as const;

/**
 * Shared scroll wrappers for the Android r50 rebuild: every scrollable view hides its
 * scroll indicators. Screens use these instead of the raw React Native lists.
 */
export function NoScrollbarScrollView(props: ScrollViewProps) {
  return <ScrollView {...props} {...HIDE_INDICATORS} />;
}

export function NoScrollbarFlatList<ItemT>(props: FlatListProps<ItemT>) {
  return <FlatList {...props} {...HIDE_INDICATORS} />;
}

export function NoScrollbarSectionList<ItemT, SectionT extends { data: readonly ItemT[] }>(props: SectionListProps<ItemT, SectionT>) {
  return <SectionList {...props} {...HIDE_INDICATORS} />;
}
