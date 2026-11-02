# @jobhub/motions

The tooling that renders the Explainer Videos (ADR-0066, #567). The Motion Scripts themselves live with their Tutorials
in `packages/help/motions/<locale>/<id>.md` (format: `packages/help/src/motion-scripts.ts`); this package films them,
voices them, composes them and publishes them. The `motions` workflow runs it (runbook: `docs/ops/motions.md`); nothing
here runs on a Mac nor in the web app, which never imports it.

| Stage | File | What it does |
| --- | --- | --- |
| plan | `src/select.ts` | the motions flagged « Motion à régénérer » since the last Version, plus those whose script changed; or all; or the ones named |
| narrate | `src/voice.ts`, `src/narration.ts` | each sentence read by the synthetic voice, measured with ffprobe |
| capture | `src/capture.ts`, `src/demo-seed.ts`, `e2e/motions.spec.ts` | Playwright plays the script's actions on the demo Candidate, 1280 × 720, FR then EN, each step held as long as its narration |
| render | `src/timeline.ts`, `src/remotion/`, `src/render.ts` | Remotion: title card, zooms, step titles, the voice; WebVTT captions and the transcript from the same script; the poster |
| publish | `src/bucket.ts`, `src/run.ts`, `src/summary.ts` | `<script>/<langue>/<hash du script>/` in the bucket, `manifest.json`, the run's summary |

Run a stage by hand: `npm run motions -w @jobhub/motions -- <plan|narrate|render|publish|samples> --work <dir>`; the
capture is `MOTIONS_WORK=<dir> npx playwright test --project=motions` (it needs the built app and Postgres, like e2e).
Locally, `MOTIONS_CHROMIUM` may name a Chromium for Remotion (Playwright's headless shell), and `MOTIONS_BUCKET_DIR` a
folder standing for the bucket.

## Demo data only

The captures run on the throwaway database of the run, on a fictitious Candidate (`src/demo-seed.ts`: « Claire Démo »,
invented employers, `*.jobbbox.test` and `*.invalid` addresses), never on real data. So the narration sent to the voice
provider holds nothing personal: its key is a CI secret, neither a Tool nor a Recipient (ADR-0066). No language model is
called: the voice reads the reviewed script as written.

## The voice

Three providers with a large French and English catalogue are wired in, each by its REST API (`src/voice.ts`):
ElevenLabs (multilingual model), Azure AI Speech (France Central) and Google Cloud Text-to-Speech (EU endpoint). The
product owner chooses by ear from the samples the workflow renders (`voice-samples`), then sets the repository variables
`MOTIONS_VOICE_PROVIDER`, `MOTIONS_VOICE_FR`, `MOTIONS_VOICE_EN`. Without any key, `espeak-ng` reads a draft that is
rendered but never published. The transcript says « Voix de synthèse » (AI Act art. 50; the voice imitates no one).

## Remotion licence

Checked on 2026-11-02 in Remotion's `LICENSE.md` (https://github.com/remotion-dev/remotion/blob/main/LICENSE.md),
version 4.0.535: « You are eligible to use Remotion for free if you are: an individual; a for-profit organization with
up to 3 employees; […] ». Beyond that, a Company License is required (prices: https://remotion.pro/license). The licence
text does not say whether contractors or coding agents count; Remotion's licence FAQ, as quoted in the research of #499
(`docs/research/issue-499.md` §4), counts the people and coding agents who write Remotion code. Jobbbox is within the
free tier while at most 3 people, agents included, write code in `src/remotion/`. Past that: buy the Company License, or
fall back to ffmpeg (ADR-0066), which can overlay the capture, the audio and the title card with `-filter_complex` and
leaves the captions as they are (WebVTT, never burnt in). Re-check this section at each Remotion major version (the
licence says it « will slightly change » in Remotion 5.0).
