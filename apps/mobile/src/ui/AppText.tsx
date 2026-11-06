import type { ReactNode } from "react";
import { Text, useWindowDimensions, type TextStyle } from "react-native";
import type { Colors } from "../theme/colors";
import { INTER, type, useTheme } from "../theme/theme";

type Variant = "body" | "lead" | "h3" | "h2" | "h1" | "meta";

const SIZE: Record<Variant, number> = { ...type.fontSize, meta: type.metaFontSize };
const HEADING: ReadonlySet<Variant> = new Set(["h1", "h2", "h3"]);

/**
 * The app's text: Inter at the Confort Density's sizes, which the system's Dynamic Type or font scale enlarges (ADR-0009's
 * amendment for the app: no Text Size of its own). Body text never under 16 pt; `meta` (13 pt) for metadata only.
 */
/**
 * From this system text scale on, no text is cut (#705, ADR-0009): the largest standard sizes (iOS's xxxL, 135 %;
 * Android's 130 %) and every accessibility size show a text whole, on as many lines as it takes.
 */
export const WHOLE_FROM_FONT_SCALE = 1.3;

export function AppText({
  variant = "body",
  weight,
  tone = "text",
  centered = false,
  lines,
  struck = false,
  heading = false,
  children,
}: {
  variant?: Variant;
  weight?: keyof typeof INTER;
  tone?: keyof Colors;
  centered?: boolean;
  /** At most this many lines, then an ellipsis; all of it at a large system text size (`WHOLE_FROM_FONT_SCALE`). */
  lines?: number;
  /** Struck through: a Cancelled Interview's title. */
  struck?: boolean;
  /** A heading for assistive technology, of a section of the page. */
  heading?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const size = SIZE[variant];
  const style: TextStyle = {
    fontFamily: INTER[weight ?? (HEADING.has(variant) ? "bold" : "regular")],
    fontSize: size,
    lineHeight: Math.round(size * (HEADING.has(variant) ? 1.25 : type.lineHeight)),
    color: colors[tone],
    textAlign: centered ? "center" : undefined,
    textDecorationLine: struck ? "line-through" : undefined,
  };
  return (
    <Text style={style} numberOfLines={fontScale < WHOLE_FROM_FONT_SCALE ? lines : undefined} role={heading ? "heading" : undefined}>
      {children}
    </Text>
  );
}
