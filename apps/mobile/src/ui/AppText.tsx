import type { ReactNode } from "react";
import { Text, type TextStyle } from "react-native";
import type { Colors } from "../theme/colors";
import { INTER, type, useTheme } from "../theme/theme";

type Variant = "body" | "lead" | "h3" | "h2" | "h1" | "meta";

const SIZE: Record<Variant, number> = { ...type.fontSize, meta: type.metaFontSize };
const HEADING: ReadonlySet<Variant> = new Set(["h1", "h2", "h3"]);

/**
 * The app's text: Inter at the Confort Density's sizes, which the system's Dynamic Type or font scale enlarges (ADR-0009's
 * amendment for the app: no Text Size of its own). Body text never under 16 pt; `meta` (13 pt) for metadata only.
 */
export function AppText({
  variant = "body",
  weight,
  tone = "text",
  align,
  lines,
  children,
}: {
  variant?: Variant;
  weight?: keyof typeof INTER;
  tone?: keyof Colors;
  align?: TextStyle["textAlign"];
  /** At most this many lines, then an ellipsis. */
  lines?: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const size = SIZE[variant];
  const style: TextStyle = {
    fontFamily: INTER[weight ?? (HEADING.has(variant) ? "bold" : "regular")],
    fontSize: size,
    lineHeight: Math.round(size * (HEADING.has(variant) ? 1.25 : type.lineHeight)),
    color: colors[tone],
    textAlign: align,
  };
  return (
    <Text style={style} numberOfLines={lines}>
      {children}
    </Text>
  );
}
