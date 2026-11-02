import { render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { NoScrollbarFlatList, NoScrollbarScrollView, NoScrollbarSectionList } from '../ui/NoScrollbar';
import { formatHits, rawScrollImports, readMobileFile, uiSourceFiles } from './sourceScan';

const WRAPPER = 'src/ui/NoScrollbar.tsx';

describe('no-scrollbar wrapper', () => {
  it('hides vertical and horizontal indicators, even when a caller asks to show them', async () => {
    const scroll = await render(
      <NoScrollbarScrollView testID="scroll" showsVerticalScrollIndicator={true} showsHorizontalScrollIndicator={true}>
        <View />
      </NoScrollbarScrollView>,
    );
    expect(screen.getByTestId('scroll')).toHaveProp('showsVerticalScrollIndicator', false);
    expect(screen.getByTestId('scroll')).toHaveProp('showsHorizontalScrollIndicator', false);
    await scroll.unmount();

    const flat = await render(
      <NoScrollbarFlatList
        testID="flat"
        data={['one']}
        keyExtractor={(item) => item}
        renderItem={({ item }) => <Text>{item}</Text>}
        showsVerticalScrollIndicator={true}
      />,
    );
    expect(screen.getByTestId('flat')).toHaveProp('showsVerticalScrollIndicator', false);
    expect(screen.getByTestId('flat')).toHaveProp('showsHorizontalScrollIndicator', false);
    await flat.unmount();

    const section = await render(
      <NoScrollbarSectionList
        testID="section"
        sections={[{ data: ['one'] }]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => <Text>{item}</Text>}
        showsHorizontalScrollIndicator={true}
      />,
    );
    expect(screen.getByTestId('section')).toHaveProp('showsVerticalScrollIndicator', false);
    expect(screen.getByTestId('section')).toHaveProp('showsHorizontalScrollIndicator', false);
    await section.unmount();
  });

  it('flags a raw ScrollView, FlatList or SectionList import from react-native', () => {
    expect(rawScrollImports("import { Pressable, ScrollView, View } from 'react-native';")).toEqual(['ScrollView']);
    expect(rawScrollImports("import { FlatList as List } from 'react-native';")).toEqual(['FlatList']);
    expect(rawScrollImports("import type { ScrollView } from 'react-native';")).toEqual([]);
    expect(rawScrollImports("import * as RN from 'react-native';\nconst x = <RN.SectionList />;")).toEqual(['RN.SectionList']);
    expect(rawScrollImports("import { NoScrollbarScrollView as ScrollView } from '../ui/NoScrollbar';")).toEqual([]);
  });

  it('fails if any mobile screen uses a raw ScrollView, FlatList or SectionList with visible indicators instead of the wrapper', () => {
    const hits = uiSourceFiles()
      .filter((file) => file !== WRAPPER)
      .flatMap((file) => {
        const names = rawScrollImports(readMobileFile(file));
        return names.length ? [formatHits(file, names)] : [];
      });
    expect(hits).toEqual([]);
  });
});
