"use client";

import type { MicroAnimationId } from "@jobhub/help/micro-animations";
import { useId, type ComponentType } from "react";
import { useTranslation } from "react-i18next";

/**
 * The drawings of the Micro-animations (#569), in SVG: each element's movement is a keyframe of MicroAnimation.css, and
 * its resting style there is the final state, the still image shown under reduced motion. Decoration only, inside the
 * `aria-hidden` stage; the few words are the interface's own labels.
 */

/** The pointer, its tip at its origin: moved by its own keyframes. */
function Pointer({ className }: { className: string }) {
  return (
    <g className={`ma-pointer ${className}`}>
      <path d="M0 0v15l4-3.6 3 6 2.6-1.2-3-5.8h5.4z" />
    </g>
  );
}

/** A browser window: its tab strip and toolbar, an extensions icon (the jigsaw piece) at the right. */
function ExtensionSidePanel() {
  const { t } = useTranslation();
  const clip = `ma-esp-window-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 240 140" className="ma-art ma-esp" focusable={false}>
      <defs>
        <clipPath id={clip}>
          <rect x="6" y="6" width="228" height="128" rx="8" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect className="ma-surface" x="6" y="6" width="228" height="128" rx="8" />
        <rect className="ma-chrome" x="6" y="6" width="228" height="30" />
        <rect className="ma-field" x="16" y="13" width="140" height="16" rx="8" />
        <path className="ma-icon" d="M200 14h5a3 3 0 0 1 6 0h5v6a3 3 0 0 1 0 6v5h-16z" />
        <g className="ma-esp__pinned">
          <rect className="ma-accent" x="174" y="13" width="17" height="17" rx="4" />
          <text className="ma-on-accent" x="182.5" y="25.5" fontSize="11" fontWeight="700" textAnchor="middle">
            J
          </text>
        </g>
        <rect className="ma-line" x="24" y="52" width="120" height="8" rx="4" />
        <rect className="ma-line" x="24" y="68" width="150" height="6" rx="3" />
        <rect className="ma-line" x="24" y="80" width="130" height="6" rx="3" />
        <rect className="ma-line" x="24" y="92" width="142" height="6" rx="3" />
        <g className="ma-esp__panel">
          <rect className="ma-panel" x="152" y="36" width="82" height="98" />
          <rect className="ma-accent" x="162" y="46" width="40" height="8" rx="4" />
          <rect className="ma-line" x="162" y="62" width="62" height="6" rx="3" />
          <rect className="ma-line" x="162" y="74" width="54" height="6" rx="3" />
          <rect className="ma-accent" x="162" y="112" width="62" height="14" rx="7" />
        </g>
        <g className="ma-esp__menu">
          <rect className="ma-menu" x="132" y="34" width="96" height="34" rx="6" />
          <rect className="ma-accent" x="140" y="44" width="14" height="14" rx="3" />
          <text className="ma-text" x="160" y="55" fontSize="10">
            {t("app.name")}
          </text>
          <path className="ma-pin" d="M210 45l6 6-3 1-3 4-1-3-4 4-1-1 4-4-3-1 4-3z" />
        </g>
      </g>
      <rect className="ma-outline" x="6" y="6" width="228" height="128" rx="8" />
      <Pointer className="ma-esp__pointer" />
    </svg>
  );
}

/** An email with a job offer: « Transférer », the Forwarding address as recipient, then « Envoyer ». */
function ForwardEmail() {
  const { t } = useTranslation();
  return (
    <svg viewBox="0 0 240 140" className="ma-art ma-fwd" focusable={false}>
      <rect className="ma-surface ma-outline" x="6" y="6" width="228" height="128" rx="8" />
      <rect className="ma-line" x="18" y="18" width="110" height="8" rx="4" />
      <rect className="ma-line" x="18" y="34" width="180" height="6" rx="3" />
      <rect className="ma-line" x="18" y="46" width="160" height="6" rx="3" />
      <g className="ma-fwd__forward">
        <rect className="ma-chip" x="150" y="14" width="74" height="18" rx="9" />
        <path className="ma-icon-stroke" d="M158 26l5-4-5-4M163 22h-4a3 3 0 0 0-3 3" />
        <text className="ma-text" x="168" y="27" fontSize="9">
          {t("microAnimation.art.forward")}
        </text>
      </g>
      <g className="ma-fwd__compose">
        <rect className="ma-menu" x="18" y="60" width="206" height="66" rx="6" />
        <text className="ma-meta" x="28" y="79" fontSize="9">
          {t("microAnimation.art.to")}
        </text>
        <rect className="ma-field" x="46" y="70" width="166" height="13" rx="4" />
        <rect className="ma-fwd__address ma-accent-soft" x="49" y="72" width="120" height="9" rx="3" />
        <rect className="ma-line" x="28" y="92" width="150" height="5" rx="2.5" />
        <g className="ma-fwd__send">
          <rect className="ma-accent" x="160" y="104" width="54" height="16" rx="8" />
          <text className="ma-on-accent" x="187" y="115" fontSize="9" textAnchor="middle">
            {t("microAnimation.art.send")}
          </text>
        </g>
        <g className="ma-fwd__sent">
          <circle className="ma-accent" cx="146" cy="112" r="7" />
          <path className="ma-check" d="M142.5 112l2.5 2.5 4.5-5" />
        </g>
      </g>
      <Pointer className="ma-fwd__pointer" />
    </svg>
  );
}

/** The sample letters that grow with the text size: the same in every language. */
const SAMPLE = "Aa";

/** Mon compte, Préférences: « Taille du texte », its thumb moved from Standard to Grand, a sample text growing. */
function TextSize() {
  const { t } = useTranslation();
  const notches = [40, 93, 146, 199];
  return (
    <svg viewBox="0 0 240 140" className="ma-art ma-size" focusable={false}>
      <rect className="ma-surface ma-outline" x="6" y="6" width="228" height="128" rx="8" />
      <text className="ma-text" x="20" y="28" fontSize="11" fontWeight="600">
        {t("textSize.label")}
      </text>
      <rect className="ma-line" x="40" y="44" width="159" height="4" rx="2" />
      <rect className="ma-size__fill ma-accent" x="40" y="44" width="159" height="4" rx="2" />
      {notches.map((x) => (
        <circle key={x} className="ma-notch" cx={x} cy="46" r="3" />
      ))}
      <g className="ma-size__thumb">
        <circle className="ma-accent" cx="0" cy="46" r="8" />
      </g>
      <text className="ma-meta" x="40" y="66" fontSize="8" textAnchor="middle">
        {t("textSize.small")}
      </text>
      <text className="ma-meta" x="199" y="66" fontSize="8" textAnchor="middle">
        {t("textSize.xlarge")}
      </text>
      <g className="ma-size__sample">
        <text className="ma-text" x="20" y="96" fontSize="12">
          {SAMPLE}
        </text>
        <rect className="ma-line" x="44" y="88" width="120" height="7" rx="3.5" />
        <rect className="ma-line" x="20" y="106" width="150" height="7" rx="3.5" />
      </g>
      <Pointer className="ma-size__pointer" />
    </svg>
  );
}

/** An Application: its status set to « Entretien », then its « Entretiens » part offers « Ajouter l'entretien ». */
function InterviewStatus() {
  const { t } = useTranslation();
  return (
    <svg viewBox="0 0 240 140" className="ma-art ma-itv" focusable={false}>
      <rect className="ma-surface ma-outline" x="6" y="6" width="228" height="128" rx="8" />
      <text className="ma-meta" x="18" y="24" fontSize="9">
        {t("application.statusLabel")}
      </text>
      <rect className="ma-field" x="18" y="30" width="96" height="18" rx="4" />
      <text className="ma-itv__before ma-text" x="26" y="43" fontSize="10">
        {t("applicationStatuses.applied")}
      </text>
      <text className="ma-itv__after ma-text" x="26" y="43" fontSize="10">
        {t("applicationStatuses.interview")}
      </text>
      <path className="ma-icon-stroke" d="M102 37l4 4 4-4" />
      <text className="ma-text" x="18" y="80" fontSize="11" fontWeight="600">
        {t("application.interviewsTitle")}
      </text>
      <g className="ma-itv__add">
        <rect className="ma-accent" x="18" y="92" width="110" height="20" rx="10" />
        <text className="ma-on-accent" x="73" y="105.5" fontSize="9" textAnchor="middle">
          {t("application.addInterview")}
        </text>
      </g>
      <g className="ma-itv__list">
        <rect className="ma-menu" x="18" y="50" width="96" height="46" rx="6" />
        <text className="ma-text" x="26" y="64" fontSize="9">
          {t("applicationStatuses.applied")}
        </text>
        <text className="ma-text" x="26" y="76" fontSize="9">
          {t("applicationStatuses.followed_up")}
        </text>
        <rect className="ma-itv__highlight ma-accent-soft" x="20" y="80" width="92" height="13" rx="3" />
        <text className="ma-text" x="26" y="89.5" fontSize="9">
          {t("applicationStatuses.interview")}
        </text>
      </g>
      <Pointer className="ma-itv__pointer" />
    </svg>
  );
}

/** Each Micro-animation's drawing, by its id (@jobhub/help's MICRO_ANIMATIONS). */
export const MICRO_ANIMATION_ART: Record<MicroAnimationId, ComponentType> = {
  "extension-side-panel": ExtensionSidePanel,
  "forward-email": ForwardEmail,
  "text-size": TextSize,
  "interview-status": InterviewStatus,
};
