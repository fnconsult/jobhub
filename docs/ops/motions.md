# Régénérer les motions

Decision: ADR-0066. Issue: #567. The Explainer Videos are rendered by the manual `motions` workflow
(`.github/workflows/motions.yml`) in GitHub Actions, never on a Mac, from the Motion Scripts in `packages/help/motions/`,
and published to a Scaleway bucket served at `https://media.jobbbox.ai`. MP4, VTT, transcripts and posters never enter
git. Tooling: `packages/motions` (its README describes each stage).

## Before each Promotion

1. Actions › motions › Run workflow, on `main`, with `motions = flagged` (the default).
   It renders the scripts named « Motion à régénérer : <script> » in the pull requests merged since the last Version
   tag (`docs/agents/documentation.md`), plus any script whose text changed since it was published.
2. Read the run's summary: one line per script and language, with links to the new video, its captions, transcript and
   poster. Watch the new videos.
3. A line « ⚠️ cassée » names the step and the element that broke (a renamed button, a moved page). The previous video
   stays online and the run stays green: the Promotion does not wait for it. Fix the Motion Script (its labels follow
   the Tutorial, which prevails), merge, and run the workflow again with that script's name.

Other inputs: `motions = all` re-renders everything (after a new voice, say); `motions = a,b` renders those scripts;
`fixtures` renders the test scripts of `packages/motions/fixtures` instead; `publish = false` renders without
publishing (the files are in the run's « motions » artifact); `voice-samples` adds the samples of every provider whose
key is set. A pull request that changes the tooling runs the workflow on the test scripts with the draft voice, and
publishes nothing.

## What the workflow does

| Step | |
| --- | --- |
| Plan | chooses the motions (`plan.json`), reading `manifest.json` from the bucket |
| Narrate | the voice reads each sentence; ffprobe measures it |
| Capture | builds the app (and the extension, for a Guest's videos), migrates a throwaway Postgres, signs a demo Candidate in and seeds the demo data through the app's API, then films each script in French and in English at 1280 × 720 (`npx playwright test --project=motions`) |
| Render | Remotion composes the MP4 (title card, zooms, step titles, voice, no music), writes the WebVTT captions and the transcript (« Voix de synthèse ») from the same script, and the poster |
| Publish | uploads `<script>/<langue>/<hash du script>/<rendu>/{video.mp4, captions.vtt, transcript.md, poster.jpg}`, `<rendu>` being the render's time (`20261102T090000Z`: a page a script films can change while its text does not), cached a year since a folder never changes, then `manifest.json` (cached 60 s), which names the version each script shows in each language; a broken motion keeps its previous entry |

## Secrets and variables

Set by `scripts/setup/issue-567.sh`. They are the workflow's own: the scripts hold demo data only, so the voice provider
is neither a Tool nor a Recipient, and nothing goes through the app's Provider Secrets.

| Name | Kind | What |
| --- | --- | --- |
| `MOTIONS_S3_ACCESS_KEY`, `MOTIONS_S3_SECRET_KEY` | secret | the Scaleway IAM application `motions-workflow` (ObjectStorageFullAccess on the media project) |
| `MOTIONS_ELEVENLABS_API_KEY`, `MOTIONS_AZURE_SPEECH_KEY`, `MOTIONS_GOOGLE_TTS_API_KEY` | secret | the voice providers; only the chosen one is needed once the voice is chosen |
| `MOTIONS_VOICE_PROVIDER`, `MOTIONS_VOICE_FR`, `MOTIONS_VOICE_EN` | variable | the voice the product owner chose by ear (`elevenlabs`, `azure` or `google`, and its voices) |
| `MOTIONS_BUCKET` | variable | the bucket's name, `media.jobbbox.ai` by default |

Without a voice key the narration is read by `espeak-ng`, a draft that is never published; a pull request always uses
it. Without the bucket's keys (a pull request, `publish` unticked) nothing is published, and what is online is read from
`https://media.jobbbox.ai/manifest.json`.

## The bucket

- Scaleway Object Storage, region `fr-par`, bucket `media.jobbbox.ai`; each file public-read; CORS for `jobbbox.ai`
  and `staging.jobbbox.ai` (`packages/motions/bucket/cors.json`), for the Help Centre's `<track>` (#568).
- Served over HTTPS at `https://media.jobbbox.ai` by Scaleway Edge Services (managed certificate); DNS at GoDaddy:
  `media` CNAME to the Edge Services endpoint.
- Old versions stay: a published video never changes nor disappears; the manifest moves.
- Rotating the key: generate a new API key on the IAM application, `gh secret set MOTIONS_S3_SECRET_KEY` (and the
  access key), then delete the old one.

## In the Help Centre (#568)

A Tutorial whose `motion` has a published version in the page's language shows, under its text, the native player
(`preload="none"`, the poster, no autoplay), its duration, and the transcript to unfold; the captions join at the first
play. Without one, the page shows the Tutorial alone. The Coach Panel's card of that Tutorial links to it, « Voir la
vidéo (durée) »; no video plays there. The web app reads `manifest.json` from `HELP_MEDIA_ORIGIN` (a Platform Setting,
`https://media.jobbbox.ai` by default; set on the Beta from the Back Office, never in its `.env`). The transcript is the
Motion Script's text when the video was rendered from it (same hash), else the `transcript.md` published with the video.
The bucket's CORS (`packages/motions/bucket/cors.json`) lets the pages read the captions.

## Writing a Motion Script

See `packages/help/src/motion-scripts.ts`. A `##` heading per step; its capture actions as list lines; then its
narration, which says everything shown on screen. The build refuses a script without its translation, one whose English
steps or actions differ from the French ones, a Tutorial whose `motion` names no script, a script no Tutorial names, and
a route that is no page of the web app. Keep a video between 30 and 90 s: the run warns outside.

| Action | What it does |
| --- | --- |
| `goto /path` | opens a page of the web app (`/en/…` for a Visitor's English page) |
| `click`, `hover`, `scroll`, `zoom <target>`, `zoom off` | on an element: `button « … »` (a role and its name), `label « … »`, `text « … »`; a link that opens a new tab carries on in the filmed one |
| `fill <target> « text »` | types it; a date or a time is given as the field's value (`2027-03-16T10:00`) |
| `select <target> « option »` | chooses an option of a list (« Statut ») |
| `press <Key>` | a key |
| `upload <target> « cv-claire-demo.pdf »` | gives the demo CV to a file input (`MOTION_DEMO_FILES`) |
| `open-email « subject »` | shows the last email the address typed before received, as a mail client shows it; its link leads back to the app |
| `pay <target>` | clicks « Passer au paiement » and pays in Stripe's test mode; the video goes on where Stripe sends the Candidate back, without Stripe's page |
| `goto @offre-de-demo`, `goto @panneau-extension` | a Guest's script (`viewer: guest`): the invented job offer, and the extension's Side Panel beside it |

`viewer:` says who is filmed: `candidate` (the default: a demo Candidate signed in, with a Profile and three
Applications), `visitor` (nobody: the video may sign up, with an address of its own at `motions.jobbbox.test`), or `guest`
(nobody, the extension loaded). A `guest` script that films no page of the web app declares `routes: []`; a change to the
extension's Side Panel (`apps/extension/entrypoints/sidepanel/`) or its badge flags its scripts « Motion à régénérer ».
Each capture has its own demo Candidate: one video never sees what another changed.

The six videos (#570), each with its Tutorial:

| Script | Tutorial | Filmed as |
| --- | --- | --- |
| `commencer` | « Commencer : de l'inscription à votre premier profil » | a Visitor who signs up |
| `extension-analyser-offre` | « Analyser une offre avec l'extension, sans compte » | a Guest |
| `postuler-cv-adapte` | « Postuler avec un CV adapté » | the demo Candidate |
| `transferer-offres-email` | « Transférer vos offres reçues par e-mail » | the demo Candidate |
| `reserver-seance-coach` | « Réserver et payer une séance avec un coach humain » | the demo Candidate, the demo Human Coach added by the run's Administrator, paid in Stripe's test mode |
| `extension-creer-compte` | « Créer son compte depuis l'extension et garder son travail » | a Guest who signs up |

A broken capture leaves `capture-failure.png` and `capture-failure.aria.txt` (the page's accessibility tree) beside its
error in the run's « motions » artifact: the element's new name is usually there. CI films every script in both
languages on each pull request (`e2e/motions.spec.ts`), with short pauses, so a renamed label breaks there first.

The extension speaks French to a Guest whatever the browser's language: the English videos of a Guest show the French
panel until it is signed in, and their actions name its French labels.
