// Adapted from Kilo-Org/kilocode 6fd9b7b: packages/opencode/src/kilocode/tool/ods.ts.
import { CFB } from "xlsx";

function attribute(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(["'])(.*?)\\1`))?.[2];
}

export function hiddenOdsSheets(bytes: Uint8Array): Set<number> {
  const archive = CFB.read(bytes, { type: "buffer" });
  const content = CFB.find(archive, "content.xml")?.content;
  if (!content) {
    return new Set();
  }
  const xml = new TextDecoder().decode(content);
  const styles = new Set(
    // A self-closing cell style must not consume the following complete table style.
    Array.from(
      xml.matchAll(/<style:style(?=[\s>])([^>]*?)(?<!\/)>([\s\S]*?)<\/style:style\s*>/g),
    ).flatMap((match) => {
      if (attribute(match[1]!, "family") !== "table") {
        return [];
      }
      const hidden =
        /<style:table-properties(?=[\s>])[^>]*\btable:display\s*=\s*(["'])false\1/.test(match[2]!);
      const name = attribute(match[1]!, "name");
      return hidden && name ? [name] : [];
    }),
  );
  return new Set(
    Array.from(xml.matchAll(/<table:table(?=[\s>])([^>]*)>/g)).flatMap((match, index) => {
      const style = attribute(match[1]!, "style-name");
      return style && styles.has(style) ? [index] : [];
    }),
  );
}
