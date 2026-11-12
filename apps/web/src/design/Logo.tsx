import { useId } from "react";
import "./Logo.css";

/**
 * Jobbbox's symbol, « La boîte qui répond » (ADR-0105): a letterbox in the shape of a speech bubble. The offer goes into
 * the slot; the three dots are the coach answering, and the three b's of the name. Its colours are the brand's own, the
 * same in both themes (they read on the light and on the dark background), so they are written here and not in the
 * stylesheet. Decorative: the name beside it, or the link's label, says « Jobbbox ».
 *
 *   <Logo />            still
 *   <Logo animated />   plays once when it is drawn (Logo.css), still under `prefers-reduced-motion`
 */
export function Logo({ animated = false }: { animated?: boolean }) {
  const id = useId();
  const url = (name: string) => `url(#${id}${name})`;
  return (
    <svg className="ds-logo" data-animated={animated || undefined} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7482f5" />
          <stop offset="1" stopColor="#5261e3" />
        </linearGradient>
        <linearGradient id={`${id}side`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4350c8" />
          <stop offset="1" stopColor="#3743b0" />
        </linearGradient>
        <linearGradient id={`${id}paper`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eceefb" />
        </linearGradient>
        <clipPath id={`${id}slot`}>
          <path d="M-20-90H116V36.500H-20z" />
        </clipPath>
      </defs>
      <path transform="translate(0 6.500)" d={BUBBLE} fill={url("side")} />
      <g className="ds-logo__top">
        <path d={BUBBLE} fill={url("front")} />
        <path d="M27 19.200H69" fill="none" stroke="#d3d8ff" strokeWidth="1.300" strokeLinecap="round" opacity=".8" />
        <rect x="26" y="33" width="44" height="7.500" rx="3.750" fill="#262d85" />
        <g clipPath={url("slot")}>
          <g className="ds-logo__offer">
            <rect x="32" y="10" width="32" height="44" rx="3.200" fill={url("paper")} stroke="#c3c9f3" strokeWidth=".7" />
            <rect x="37" y="15.500" width="7" height="7" rx="2.200" fill="#6170ee" />
            <path d="M48 17.200h9" fill="none" stroke="#7d88e6" strokeWidth="2" strokeLinecap="round" />
            <path d="M48 21.600h3M37 29.500h22" fill="none" stroke="#c3c9f3" strokeWidth="1.700" strokeLinecap="round" />
          </g>
        </g>
        <circle className="ds-logo__dot" cx="34" cy="55" r="4" fill="#dfe3ff" />
        <circle className="ds-logo__dot" cx="48" cy="55" r="4" fill="#dfe3ff" />
        <circle className="ds-logo__dot" cx="62" cy="55" r="4" fill="#dfe3ff" />
      </g>
    </svg>
  );
}

/** The speech bubble: a rounded box with its tail at the bottom left. */
const BUBBLE = "M27 18H69a17 17 0 0 1 17 17V53a17 17 0 0 1-17 17H45L29 83.500V70H27a17 17 0 0 1-17-17V35a17 17 0 0 1 17-17z";
