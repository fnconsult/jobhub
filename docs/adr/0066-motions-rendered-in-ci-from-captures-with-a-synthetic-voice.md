# Motions are rendered in CI from Playwright captures, with a synthetic voice, and served from Scaleway; the Tutorial's text stays the source of truth

_Decided in the grilling of #506 (map #494), on the research of #499. Builds on ADR-0065 (Tutorials) and ADR-0009 (accessibility floor)._

Jobbbox wants short Explainer Videos and Micro-animations, played only on demand (no GIF, no tour: #341, ADR-0035). The interface changes with every release, a person cannot re-record videos at that pace, and the audience is 40+. We decided:

- **A motion never stands alone.** Each Explainer Video and Micro-animation is attached to a Tutorial (or, for a Micro-animation, a page's empty state), which reads complete without it. A video out of date stays online while its Tutorial is right: the text is what counts.
- **Few videos, for Candidates and Guests.** 6 to 8 at launch, one task each, 30 to 90 s, shown only in the Help Centre (the Coach Panel's card links to it). None for the Back Office or Human Coaches. More come from Unanswered Questions.
- **Rendered from code.** Playwright captures the real interface on demo data, in French and in English, and Remotion composes the video. The Motion Script, kept with its Tutorial in `packages/help`, is the one source of the narration, the WebVTT captions and the descriptive transcript. The tooling lives apart, in `packages/motions`. A manual `motions` workflow in GitHub Actions (never on a Mac) renders the motions flagged « Motion à régénérer » (#508) before each Promotion. The product owner watches what changed, and a broken capture keeps the previous video.
- **A synthetic voice.** The narration describes what is on screen (WCAG 1.2.5), read by a third-party speech-synthesis provider with a large catalogue of French and English voices, so a voice can be chosen by ear. The transcript says « Voix de synthèse ». The scripts hold demo data only, so the provider is a CI secret, not a Tool nor a Recipient.
- **Served from Scaleway, never from a video platform.** MP4, VTT and posters are kept out of git, in a Scaleway Object Storage bucket in `fr-par` served at `media.jobbbox.ai`, and played in the native `<video controls>`, with no autoplay, no music and `preload="none"`. Scaleway sees viewers' addresses, so it enters the register and the Recipient list as an EU host. Under ADR-0064 that is not a substantial change.
- **Micro-animations are CSS/SVG in the repo.** « Voir comment » plays 2 to 5 s once, with « Revoir ». It is `aria-hidden` beside the written step and becomes a still image under `prefers-reduced-motion`. Claude Motion may sketch one, but is never the source.

## Considered Options

- **A human voice**: warmer, but every changed screen means re-recording in two languages.
- **Silent videos with on-screen text**: simplest, but a 40+ viewer must read while watching.
- **Claude Motion for the videos**: driven by hand in claude.ai, with no evidence that it takes our captures or runs in CI, so videos could not be regenerated when a route changes.
- **ffmpeg instead of Remotion**: no licence, but clumsy for zooms and titles. It becomes the fallback if more than 3 people (agents included) write Remotion code, past its free tier.
- **Bunny Stream or PeerTube**: adaptive streaming adds nothing for files of a few MB. Bunny can replicate outside the EU, and PeerTube is an instance to run.
- **Serving the videos through our own origin**: keeps Scaleway out of the Recipient list, but loads the VPS for no gain.
