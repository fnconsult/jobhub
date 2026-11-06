// The app's own native views on Android (modules/*/android), as prebuild compiles them (#835). Expo's ExpoView is a
// LinearLayout: left to itself, it lays out again in a row, by their own measure, the React children React Native has
// already placed, and the first one's measure is its whole width. The conversation's box, the drop target (#696), then
// drew « + » alone: the field « Votre message » and « Envoyer » sat past its edge, undrawn and out of the accessibility
// tree. A native view of the app that holds React children leaves their measure and layout to React Native.
// This reads the views' source; apps/mobile/native-tests runs them on Android's own layout code (npm run test:android).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MODULES = join(__dirname, "..", "modules");

/** Every Kotlin file under `folder`. */
function kotlinFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return kotlinFiles(path);
    return name.endsWith(".kt") ? [path] : [];
  });
}

/** Each class of `source` that extends ExpoView, with its body (from its opening brace to the one that closes it). */
function expoViews(source: string): { name: string; body: string }[] {
  return [
    ...source.matchAll(/class (\w+)\([^)]*\)\s*:\s*ExpoView\([^)]*\)[^{]*\{/g),
  ].map((match) => {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (depth > 0 && end < source.length) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    }
    return { name: match[1] ?? "", body: source.slice(start, end - 1) };
  });
}

const views = readdirSync(MODULES)
  .filter((module) =>
    statSync(join(MODULES, module, "android"), {
      throwIfNoEntry: false,
    })?.isDirectory(),
  )
  .flatMap((module) => kotlinFiles(join(MODULES, module, "android")))
  .flatMap((file) =>
    expoViews(readFileSync(file, "utf8")).map((view) => ({
      ...view,
      file: relative(MODULES, file),
    })),
  );

describe("the app's native views on Android", () => {
  it("include the conversation's box, the drop target", () => {
    expect(views.map((view) => view.name)).toContain("DropTargetView");
  });

  it.each(views.map((view) => [view.name, view]))(
    "%s leaves its children's measure and layout to React Native",
    (_name, view) => {
      // Its own size is the one React Native measured for it; its children are not measured again in a LinearLayout's way.
      expect(view.body).toMatch(
        /override fun onMeasure\(widthMeasureSpec: Int, heightMeasureSpec: Int\)/,
      );
      expect(view.body).toContain(
        "setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))",
      );
      expect(view.body).not.toContain("super.onMeasure(");
      // Its children stay where React Native put them.
      expect(view.body).toMatch(
        /override fun onLayout\(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int\) = Unit/,
      );
      expect(view.body).not.toMatch(
        /shouldUseAndroidLayout\s*(:\s*Boolean\s*)?=\s*true/,
      );
    },
  );
});
