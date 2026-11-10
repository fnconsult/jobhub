import { badgeCount } from "@jobhub/shared";
import { Text, View } from "react-native";
import { INTER, radius, space, type, useTheme } from "../theme/theme";
import { ROW_MAX_SCALE } from "./AppText";

/** The pill's height, and its least width: a single digit sits in a circle. */
const PILL = 18;
/** Its digits' side padding. */
const PADDING = 5;
/** From the label before it: 4 pt, where a counted row's parts stand `space[2]` apart. */
const FROM_LABEL = space[1] - space[2];

/**
 * A count at a row's end (#939, option B of the prototype): a compact pill in the accent, its digits at the meta size,
 * semi-bold and tabular, as the web Sidebar's `.sidebar-count`; over 99, « 99+ » (`badgeCount`). Its row, accessible as
 * one, says the exact number in words to VoiceOver and TalkBack. It grows with the system's text size as its row does.
 */
export function CountBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        minHeight: PILL,
        minWidth: PILL,
        paddingHorizontal: PADDING,
        marginLeft: FROM_LABEL,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: radius.control,
        backgroundColor: colors.accent,
      }}
    >
      <Text
        maxFontSizeMultiplier={ROW_MAX_SCALE}
        style={{ fontFamily: INTER.semiBold, fontSize: type.metaFontSize, lineHeight: PILL, fontVariant: ["tabular-nums"], color: colors.onAccent }}
      >
        {badgeCount(count)}
      </Text>
    </View>
  );
}
