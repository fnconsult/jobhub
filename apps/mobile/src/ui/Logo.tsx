import { LOGO } from "@jobhub/shared/logo";
import { useId } from "react";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";

const C = LOGO.colors;

/** The drawing's geometry, outside the JSX: none of it is text a person reads. */
const D = {
  viewBox: "4 6 88 88",
  hidden: "no-hide-descendants",
  slotClip: "M-20-90H116V36.500H-20z",
  side: "translate(0 6.5)",
  highlight: "M27 19.200H69",
  title: "M48 17.200h9",
  lines: "M48 21.600h3M37 29.500h22",
  none: "none",
  round: "round",
} as const;

/**
 * Jobbbox's symbol, « La boîte qui répond » (#988, ADR-0105), from @jobhub/shared/logo: a letterbox in the shape of a
 * speech bubble, the offer in its slot, the three dots of the coach answering. Still: it moves only in the web's public
 * header. Its colours are the brand's, the same in both themes. Decorative: the name beside it says « Jobbbox ».
 */
export function Logo({ size, testID }: { size: number; testID?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = { front: `${id}front`, side: `${id}side`, paper: `${id}paper`, slot: `${id}slot` };
  const url = (name: keyof typeof ids) => `url(#${ids[name]})`;
  const fill = { front: url("front"), side: url("side"), paper: url("paper"), slot: url("slot") };
  return (
    <Svg testID={testID} width={size} height={size} viewBox={D.viewBox} accessible={false} aria-hidden importantForAccessibility={D.hidden}>
      <Defs>
        <LinearGradient id={ids.front} x1={0} y1={0} x2={0} y2={1}>
          <Stop offset={0} stopColor={C.front[0]} />
          <Stop offset={1} stopColor={C.front[1]} />
        </LinearGradient>
        <LinearGradient id={ids.side} x1={0} y1={0} x2={0} y2={1}>
          <Stop offset={0} stopColor={C.side[0]} />
          <Stop offset={1} stopColor={C.side[1]} />
        </LinearGradient>
        <LinearGradient id={ids.paper} x1={0} y1={0} x2={0} y2={1}>
          <Stop offset={0} stopColor={C.paper} />
          <Stop offset={1} stopColor={C.paperShade} />
        </LinearGradient>
        <ClipPath id={ids.slot}>
          <Path d={D.slotClip} />
        </ClipPath>
      </Defs>
      <Path transform={D.side} d={LOGO.bubble} fill={fill.side} />
      <Path d={LOGO.bubble} fill={fill.front} />
      <Path d={D.highlight} fill={D.none} stroke={C.highlight} strokeWidth={1.3} strokeLinecap={D.round} opacity={0.8} />
      <Rect x={26} y={33} width={44} height={7.5} rx={3.75} fill={C.slot} />
      <G clipPath={fill.slot}>
        <Rect x={32} y={10} width={32} height={44} rx={3.2} fill={fill.paper} stroke={C.paperEdge} strokeWidth={0.7} />
        <Rect x={37} y={15.5} width={7} height={7} rx={2.2} fill={C.mark} />
        <Path d={D.title} fill={D.none} stroke={C.title} strokeWidth={2} strokeLinecap={D.round} />
        <Path d={D.lines} fill={D.none} stroke={C.paperEdge} strokeWidth={1.7} strokeLinecap={D.round} />
      </G>
      <Circle cx={34} cy={55} r={4} fill={C.dot} />
      <Circle cx={48} cy={55} r={4} fill={C.dot} />
      <Circle cx={62} cy={55} r={4} fill={C.dot} />
    </Svg>
  );
}
