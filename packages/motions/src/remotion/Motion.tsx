/**
 * An Explainer Video, composed from its Timeline (ADR-0066): a title card, then the capture with its zooms on the
 * element each step points at and the step's title, and the synthetic voice, sentence by sentence. No music, no flashing
 * transition (WCAG 2.3.1), slow zooms only. The captions are not burnt in: they are the WebVTT file the player shows.
 */
import { AbsoluteFill, Audio, Easing, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FPS, INTRO_SECONDS, type Box, type Timeline } from "../timeline";

const INK = "#1a1d23";
const PAPER = "#f6f7f9";
const ACCENT = "#2a4fd6";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
/** How long a zoom takes to move, and how far it may enlarge. */
const ZOOM_SECONDS = 0.9;
const MAX_ZOOM = 1.8;

const LABELS = { fr: "Jobbbox · Tutoriel en vidéo", en: "Jobbbox · Video tutorial" } as const;

export function Motion({ timeline }: { timeline: Timeline }) {
  const intro = Math.round(INTRO_SECONDS * FPS);
  const span = Math.round((timeline.steps.at(-1)!.at + timeline.steps.at(-1)!.length - INTRO_SECONDS) * FPS);
  const startFrom = Math.round(timeline.videoFrom * FPS);
  return (
    <AbsoluteFill style={{ background: PAPER, fontFamily: FONT }}>
      <Sequence durationInFrames={intro}>
        <TitleCard timeline={timeline} />
      </Sequence>
      <Sequence from={intro} durationInFrames={span}>
        <Zoomed timeline={timeline}>
          <OffthreadVideo src={staticFile(timeline.video)} trimBefore={startFrom} muted />
        </Zoomed>
      </Sequence>
      <Sequence from={intro + span}>
        <Freeze frame={span - 1}>
          <Zoomed timeline={timeline} at={intro + span - 1}>
            <OffthreadVideo src={staticFile(timeline.video)} trimBefore={startFrom} muted />
          </Zoomed>
        </Freeze>
      </Sequence>
      {timeline.steps.map((step) => (
        <Sequence key={step.at} from={Math.round(step.at * FPS)} durationInFrames={Math.max(1, Math.round(step.length * FPS))}>
          <StepTitle title={step.title} />
        </Sequence>
      ))}
      {timeline.audio.map((audio) => (
        <Sequence key={audio.file} from={Math.round(audio.at * FPS)} durationInFrames={Math.ceil(audio.duration * FPS) + 1}>
          <Audio src={staticFile(audio.file)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function TitleCard({ timeline }: { timeline: Timeline }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 96, opacity }}>
      <div style={{ color: ACCENT, fontSize: 30, fontWeight: 600, marginBottom: 28 }}>{LABELS[timeline.locale]}</div>
      <div style={{ color: INK, fontSize: 64, fontWeight: 700, lineHeight: 1.15, textAlign: "center" }}>{timeline.title}</div>
    </AbsoluteFill>
  );
}

/** The step's title, bottom left: the app's own headings stay visible at the top. */
function StepTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 32,
        bottom: 32,
        background: INK,
        color: "#fff",
        fontSize: 26,
        fontWeight: 600,
        padding: "12px 22px",
        borderRadius: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      }}
    >
      {title}
    </div>
  );
}

/** The capture, enlarged on the current step's zoom box, moving slowly from the previous step's. */
function Zoomed({ timeline, at, children }: { timeline: Timeline; at?: number; children: React.ReactNode }) {
  const own = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const seconds = (at ?? own + Math.round(INTRO_SECONDS * FPS)) / FPS;
  const transform = zoomAt(timeline, seconds, width, height);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

/** The zoom at `seconds` of the video: the current step's box, reached over ZOOM_SECONDS from the previous step's. */
export function zoomAt(timeline: Pick<Timeline, "steps">, seconds: number, width: number, height: number): Transform {
  const index = Math.max(0, timeline.steps.filter((step) => step.at <= seconds).length - 1);
  const target = framing(timeline.steps[index]!.zoom, width, height);
  const before = framing(index > 0 ? timeline.steps[index - 1]!.zoom : null, width, height);
  const progress = interpolate(seconds - timeline.steps[index]!.at, [0, ZOOM_SECONDS], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  return { scale: mix(before.scale, target.scale, progress), x: mix(before.x, target.x, progress), y: mix(before.y, target.y, progress) };
}

/** The transform that centres `box` (with a margin) as large as MAX_ZOOM allows, never showing past the capture's edges. */
export function framing(box: Box | null, width: number, height: number): Transform {
  if (!box) return { scale: 1, x: 0, y: 0 };
  const margin = 48;
  const scale = Math.max(1, Math.min(MAX_ZOOM, width / (box.width + 2 * margin), height / (box.height + 2 * margin)));
  const clamp = (value: number, size: number) => Math.min(0, Math.max(size - size * scale, value));
  return { scale, x: clamp(width / 2 - (box.x + box.width / 2) * scale, width), y: clamp(height / 2 - (box.y + box.height / 2) * scale, height) };
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}
