import { Composition } from "remotion";
import type { Timeline } from "../timeline";
import { FPS } from "../timeline";
import { Motion } from "./Motion";

/** The « Motion » composition: its size and length come from the Timeline it is given (`inputProps`). */
export function Root() {
  return (
    <Composition
      id="Motion"
      component={Motion}
      fps={FPS}
      width={1280}
      height={720}
      durationInFrames={FPS}
      defaultProps={{ timeline: null as unknown as Timeline }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil(props.timeline.duration * FPS),
        width: props.timeline.width,
        height: props.timeline.height,
      })}
    />
  );
}
