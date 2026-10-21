# Issue #279 research: morphing an SVG line icon without a heavy dependency

Map: #278 (Signalements). Unblocks #280. Sources checked 2026-10-21: first-party docs, specs, caniuse, MDN browser-compat-data, library READMEs and npm. Bundle sizes were **measured** that day (esbuild `--bundle --minify`, then gzip) on the versions named. Anything that no primary source backs is marked **UNVERIFIED**. Choosing the implementation is left to #280.

Context from the repo, not outside facts:
- `apps/web/src/components/icons.tsx` holds hand-drawn 24×24 path strings. They are stroke-only (`.icon` in `app.css`: `fill: none; stroke: currentcolor; stroke-width: 1.75; round caps/joins`), several subpaths per icon, a mix of relative commands and arcs (`a7 7 0 1 0 0 14`), and `aria-hidden`.
- `app.css` already wraps its motion in `@media (prefers-reduced-motion: no-preference)` (drawer, sheet). ADR-0009: no function reachable only through an unlabelled icon. The Signalement button at the Sidebar foot therefore needs visible text, and the icon stays decoration.

## Verdict at a glance

| Option | Chrome / Edge | Firefox | Safari macOS + iOS | Needs matching paths | Runtime cost | Reduced motion |
|---|---|---|---|---|---|---|
| CSS `d` transition / keyframes (`d: path(...)`) | 52+ | 97+ | **No** (parses, no effect), up to 27.2 | Yes | 0 KB | Free via `@media` |
| SMIL `<animate attributeName="d">` | Yes | Yes | **Yes** (6+) | Yes | 0 KB | **Not** covered by CSS media queries. Gate it in JS |
| flubber 0.4.2 (runtime) | any | any | any | No (polygonizes) | **18.8 KB gz** | JS |
| polymorph-js 1.0.2 (runtime) | any | any | any | No | **4.8 KB gz** | JS |
| GSAP 3.15 + MorphSVGPlugin | any | any | any | No | **37.5 KB gz** (core + plugin) | JS (`gsap.matchMedia`) |
| Cross-fade / scale of 3 stacked glyphs (CSS) | any | any | any | **No** | 0 KB | Free via `@media` |
| Stroke-dash draw-on (`pathLength="1"`) | any | any | any | **No** | 0 KB | Free via `@media` |

**Recommendation:** hand-author the three glyphs with **the same subpath count and the same command sequence in each subpath**. Morph them with **SMIL `<animate attributeName="d" values="bug;info;shapes">`**, rendered only after mount when `prefers-reduced-motion: no-preference` matches. Play it once, or on hover/focus, for 5 s or less, and land on a static glyph. Fallback with no dependency: a CSS cross-fade of three stacked glyphs. Do not rely on CSS `d`: Safari, including every iPhone, ignores it. Do not ship flubber or GSAP for one icon.

## 1. Browser support

### CSS `d` property (transition / `@keyframes` / Web Animations)
- MDN browser-compat-data `css.properties.d`: Chrome **52**, Firefox **97**, Edge mirrors Chrome. Safari: `version_added: false`, note *"The property parses, but has no effect."* iOS Safari and iOS WebViews mirror Safari. https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/d.json
- caniuse (`mdn-css_properties_d`): no supported Safari or iOS Safari version, through 27.2. Technology Preview shows "support unknown". https://caniuse.com/mdn-css_properties_d
- WebKit's status: the property sits behind a disabled feature flag (WebKit bug 274935, which bug 275842 was closed as a duplicate of). In March 2025 WebKit said it was on by default in Technology Preview, but that turning it on everywhere "has been proving challenging due to performance concerns". Tracking bug 234227. https://bugs.webkit.org/show_bug.cgi?id=275842 · https://lists.w3.org/Archives/Public/public-svg-issues/2025Mar/0003.html
- MDN: `d` applies only to `<path>` inside `<svg>`. It is animatable only when the paths have the same number of data points. https://developer.mozilla.org/en-US/docs/Web/CSS/d

Consequence: in Safari a CSS-`d` morph degrades to the static `d` attribute. That is harmless, but much of a 40+ audience is on iPhone and iPad, so they would never see the morph.

### SMIL `<animate>`
- caniuse `svg-smil`: Chrome 5+, Edge 79+, Firefox 4+, Safari 6+, iOS Safari 6+ (all current versions through 27.x). About 97% global. Not supported in IE or legacy Edge 12–18. https://caniuse.com/svg-smil
- `<animate>` animates an attribute over time and implements `SVGAnimateElement` (SVG Animations Level 2). MDN asks authors to offer a way to pause it and to respect `prefers-reduced-motion`. https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/animate
- `SVGSVGElement.pauseAnimations()` / `unpauseAnimations()` freeze the SMIL clock of one `<svg>`. Baseline, widely available since July 2015. https://developer.mozilla.org/en-US/docs/Web/API/SVGSVGElement/pauseAnimations
- `begin="indefinite"` plus `beginElement()` starts it on demand, for example on hover or focus. This comes from `SVGAnimationElement` in SVG Animations; MDN's `<animate>` page does not spell it out (**UNVERIFIED on MDN**, standard SMIL API).

## 2. Paths must share their command structure

- **SVG 2, `d` property (§9.3.2):** two path values interpolate only when they have "exactly the same number and types of path data commands which are in the same order". Each parameter is then interpolated as a number, and arc flags count as 0/1. Otherwise the animation is **discrete** (it jumps). For from/by animations with incompatible values, the animation has no effect. https://www.w3.org/TR/SVG2/paths.html
- **CSS Shapes 1, `path()` interpolation (§3.1.1.2):** the lists must be "the same length and has the same commands, in order", with the same command keyword and the same by/to (relative/absolute) keyword. The spec defines no automatic conversion of `l`↔`L` or `h`/`v`→`l`. https://drafts.csswg.org/css-shapes-1/#basic-shape-interpolation

What this means for `icons.tsx`: our strings mix `h`, `v`, `l`, `a` and absolute and relative forms. To morph them natively, the three glyphs must be **re-authored to one shared skeleton**. For example, each glyph is K subpaths, and each subpath is `M C C C C Z`, all absolute:
- a circle is 4 cubic Béziers (the standard 0.5523·r handles);
- a square is 4 cubics with handles on the edges (they draw straight lines);
- a triangle is 4 cubics with one collapsed segment;
- the ⓘ stem and dot, and the bug's legs and antennae, are cubics whose handles lie on the line.

Arcs (`A`) also interpolate, but their flags snap, so cubics are safer. Pick K to cover the glyph with the most subpaths: the bug probably needs about 5 to 7. In the glyphs with fewer parts, the extra subpaths collapse to a point (stroke-linecap round makes a zero-length subpath a dot, so park them under another stroke). Illustrative only; #280 owns the drawing.

### How the libraries handle mismatched paths

- **flubber** (MIT, v0.4.2, last published 2022-06): makes a "best-guess" interpolation between arbitrary shapes. Curves are converted to polygons, smoothed by `maxSegmentLength` (default 10). Only the first outer shape of a path string is used: "everything but the first outer shape will be ignored". Holes and **unclosed lines are not supported** (listed as to-dos). `separate` / `combine` / `interpolateAll` handle one-to-many. Measured: 54.1 KB min, **18.8 KB gz** (bundlephobia: 18.1 KB gz). It is a poor fit for multi-subpath, open, stroked icons. https://github.com/veltman/flubber
- **polymorph-js** (MIT, v1.0.2, last published 2022-05): "handles variable length paths and holes". The README says "about 6k minified". Measured: 11.8 KB min, **4.8 KB gz**. No releases on GitHub, CI on the retired travis-ci.org, so it looks unmaintained. https://github.com/notoriousb1t/polymorph
- **GSAP MorphSVGPlugin** (v3.15.0): morphs paths "even if the number (and type) of points don't match", with the options `map` (size / position / complexity), `shapeIndex`, `type: "rotational"` and `precision`. It converts `<circle>`, `<rect>`, `<polygon>` and similar shapes. The docs say `shapeIndex` only works on closed paths. **Licence:** the GSAP Standard "no charge" licence, owned by Webflow. It allows commercial use, *including* former bonus plugins such as MorphSVG. It forbids tools that compete with Webflow's visual animation builder, and Webflow may revise it. It is proprietary, not OSI open source. Measured: core + plugin **37.5 KB gz** (plugin alone 9.8 KB gz). https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/ · https://gsap.com/standard-license

A middle path with no runtime cost: run a library (flubber or polymorph) **at build time, in a one-off script** to produce matched path strings. Paste them into `icons.tsx` and play them with SMIL. Flubber's polygon output is many points per shape and closed shapes only, so hand-authoring 3 glyphs is likely cleaner (**judgement, not verified**).

## 3. Alternatives that need no matching paths

- **Cross-fade / scale:** stack three `<g>` in one `<svg>` and run CSS `@keyframes` on `opacity` and `transform` (scale about 0.8→1, `transform-box: fill-box; transform-origin: center`). It works in every browser with no path constraints, and our current path strings stay unchanged. It reads as "changing" rather than "metamorphosing".
- **Stroke-dash draw-on:** put `pathLength="1"` on each path, `stroke-dasharray: 1`, and animate `stroke-dashoffset` 1→0. The old glyph un-draws, then the new one draws. Strokes only, which suits our icons. `pathLength` is an SVG 1.1 / SVG 2 attribute on `<path>`. I did not find its BCD row this session (**support table UNVERIFIED**, long-standing in all engines).
- Both can be combined, for example a draw-on with a short fade. Both are plain CSS, so the `@media (prefers-reduced-motion: no-preference)` wrapper that `app.css` already uses turns them off for free.

## 4. Reduced motion and the senior audience

- CSS animations sit inside `@media (prefers-reduced-motion: no-preference)`, the existing pattern. https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- **SMIL ignores CSS media queries.** Do not render the `<animate>` element in the server HTML. In a client effect, render it only if `matchMedia("(prefers-reduced-motion: no-preference)").matches`, and listen for `change`. Alternatively, call `svg.pauseAnimations()` when reduced motion is on. The first render, SSR included, is the static glyph, so there is no hydration mismatch and no motion before the preference is known.
- **WCAG 2.2.2 Pause, Stop, Hide (Level A, so inside our AA floor):** motion that starts automatically, lasts more than 5 s and runs alongside other content needs a way to pause, stop or hide it. The exemption covers only "essential" motion, and a decorative icon is not essential. So **no infinite loop.** Play it once on mount for 5 s or less, or play it on hover/focus, then stop. https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html
- WCAG 2.3.3 Animation from Interactions (AAA): motion triggered by interaction can be turned off. Honouring `prefers-reduced-motion` covers this. https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html
- When motion is reduced, show one static glyph, chosen in #280 (bug or ⓘ). Keep the icon `aria-hidden` next to its visible label (ADR-0009), and keep the stroke width unchanged during the morph so the icon stays legible.

## 5. Recommended approach (for #280)

1. Redraw bug, ⓘ and ○□△ on one skeleton: K absolute subpaths, each `M C C C C Z` (or one agreed sequence). Store them as three strings next to `PATHS`, or as a `MORPHS` entry.
2. Make a `MorphIcon` client component. SSR and reduced motion render a static `<path d={glyphs[0]}>`. After mount, when motion is allowed, add `<animate attributeName="d" values="a;b;c;a" keyTimes="0;.33;.66;1" calcMode="spline" keySplines="…" dur="≤5s" begin="indefinite" fill="freeze">`. Trigger it with `beginElement()` on mount, hover or focus. React 19 passes `attributeName`, `keyTimes`, `calcMode` and `keySplines` through as SVG attributes (**UNVERIFIED in this session**; check in #280).
3. Works in Chrome, Firefox, Safari and iOS Safari. 0 KB added. No licence question.
4. If the shared skeleton is too hard to draw well, fall back to the **CSS cross-fade** of the three current-style glyphs: still 0 KB and universal.
5. Rejected: CSS `d` (no Safari or iOS), flubber (18.8 KB gz, closed shapes only, first subpath only), GSAP (37.5 KB gz, proprietary Webflow licence, overkill for one icon). polymorph is small but unmaintained, and is only worth it as a build-time helper.
