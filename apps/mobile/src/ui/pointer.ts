import { useState } from "react";
import type { PointerEvent } from "react-native";

/**
 * Whether a pointer (an iPad's trackpad or mouse, an Android tablet's) is over a control, to highlight it (#700). React
 * Native's W3C pointer events, which an iPad's hover and Android's mouse both raise; Pressable's own `onHoverIn` fires
 * on the web only, unless a native flag is switched on. Spread `hoverProps` on the Pressable.
 */
export function usePointerHover() {
  const [hovered, setHovered] = useState(false);
  return { hovered, hoverProps: { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) } };
}

/** A click of the pointer's secondary button: a right click, or two fingers on a trackpad. */
export const isSecondaryClick = (event: PointerEvent) => event.nativeEvent.button === 2;
