import { Fragment, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";
import { INTER, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";

/** One block of a Legal Text's Markdown: a heading, a list, or a paragraph. */
type Block = { kind: "heading"; text: string } | { kind: "list"; items: string[] } | { kind: "paragraph"; text: string };

const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const HEADING = /^#{1,6}\s+/;

/** The blocks of `markdown`, as the repo's Legal Texts write them: blank lines between blocks, `-` or `1.` items, `#` headings. */
export function markdownBlocks(markdown: string): Block[] {
  return markdown
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => {
      const lines = chunk.split("\n");
      if (lines.every((line) => LIST_ITEM.test(line))) return { kind: "list", items: lines.map((line) => line.replace(LIST_ITEM, "")) };
      if (lines.length === 1 && HEADING.test(chunk)) return { kind: "heading", text: chunk.replace(HEADING, "") };
      return { kind: "paragraph", text: lines.join(" ") };
    });
}

/** `**bold**` and `[a link](address)` inside a block; the rest as written. */
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function Inline({ text, webAppUrl }: { text: string; webAppUrl: string }) {
  const { colors } = useTheme();
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    parts.push(text.slice(last, match.index));
    const [, bold, label, href] = match;
    if (bold) parts.push(<Text key={match.index} style={{ fontFamily: INTER.semiBold }}>{bold}</Text>);
    else {
      // A link of the Legal Texts leads to the web app (`/legal/…`) or elsewhere: either way, the system's browser.
      const address = href!.startsWith("/") ? `${webAppUrl}${href}` : href!;
      parts.push(
        <Text key={match.index} role="link" style={{ color: colors.accent, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(address).catch(() => {})}>
          {label}
        </Text>,
      );
    }
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts.map((part, index) => (typeof part === "string" ? <Fragment key={`t${index}`}>{part}</Fragment> : part))}</>;
}

/** A Legal Text's Markdown body, drawn natively: the same text as the web's page (#689). */
export function MarkdownBody({ markdown, webAppUrl }: { markdown: string; webAppUrl: string }) {
  return (
    <View style={{ gap: space[3] }}>
      {markdownBlocks(markdown).map((block, index) =>
        block.kind === "heading" ? (
          <AppText key={index} variant="h3" weight="semiBold">
            <Inline text={block.text} webAppUrl={webAppUrl} />
          </AppText>
        ) : block.kind === "list" ? (
          <View key={index} role="list" style={{ gap: space[1] }}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} role="listitem" style={{ flexDirection: "row", gap: space[2] }}>
                <AppText>•</AppText>
                <View style={{ flex: 1 }}>
                  <AppText>
                    <Inline text={item} webAppUrl={webAppUrl} />
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <AppText key={index}>
            <Inline text={block.text} webAppUrl={webAppUrl} />
          </AppText>
        ),
      )}
    </View>
  );
}
