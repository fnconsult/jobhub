"use client";

import { useRef } from "react";

/**
 * The native player of an Explainer Video (ADR-0066, #568): `<video controls>`, `preload="none"`, its poster, no
 * autoplay. Nothing but the poster is asked of the bucket before « Lecture »: the browser fetches a `<track>` as soon as
 * it is in the page, even unselected, so the captions (WebVTT, in the page's language) join at the first play, shown.
 */
export function MotionVideo({ video, poster, captions, locale, captionsLabel, unsupported, labelledBy }: {
  video: string;
  poster: string;
  captions: string;
  locale: "fr" | "en";
  captionsLabel: string;
  /** What a browser without `<video>` shows. */
  unsupported: string;
  labelledBy: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  function addCaptions() {
    const element = ref.current;
    if (!element || element.querySelector("track")) return;
    const track = document.createElement("track");
    track.kind = "captions";
    track.srclang = locale;
    track.label = captionsLabel;
    track.src = captions;
    track.default = true;
    element.appendChild(track);
    track.track.mode = "showing";
  }
  return (
    <video ref={ref} className="help-video__player" controls preload="none" poster={poster} crossOrigin="anonymous" playsInline aria-labelledby={labelledBy} onPlay={addCaptions} data-motion-video>
      <source src={video} type="video/mp4" />
      {unsupported}
    </video>
  );
}
