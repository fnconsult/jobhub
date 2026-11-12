# Human Coach transition (#888)

The Human Coach epic is merged behind « Espace coach v2 » (`COACH_SPACE_V2`, ADR-0106), off by default. While it is off, Coaches keep the former Coach space at `/espace-coach` (their Coaching Sessions and Coach Access list, with no contract to accept). Candidates, visitors, e-mails, push notifications, the worker, the apps and the Help Centre see what they saw before the epic, and the epic's new routes answer 404. The Back Office's coaching pages, Outils and provider setup are available whatever its value, so offers, Sellers and providers can be prepared beforehand.

Turning it on approves nothing. Current human-authored contract acceptance is then mandatory before Candidate access. New third-party and Jobbbox-funded Connect sales require current CGV/privacy/B2B capability coverage, a supported fiscal identity, the frozen professional recipient and an active connected account. Existing paid sessions, owed refunds and financial documents retain their reviewed access and reconciliation rules.

Cal.com additionally requires the actual team/event identity, secrets, verified single-host duration, confirmation that all Cal reminders/workflows are disabled, outside-EU privacy coverage and the observed 30-day publication interval. Reminder delivery retains its own current-text and Cal-reminder checks. No environment target supplies an approval. Test-only synthetic legal fixtures require deliberate harness preloading and are absent from the standalone app.

## Switch-over (#888)

#888 is « turn it on, then retire the former Coach space », in this order:

1. The gates are met: approved versions of #518 (B2B contract), #889 (CGV) and #890 (privacy policy, published 30 days before Cal.com is used), real Stripe Connect and Cal.com credentials and team set-up, Cal reminders/workflows confirmed off. DAC7 (#887) stays fail-closed until the official DGFiP schema is imported.
2. Each Human Coach is told, before the switch, that they will accept the B2B contract on their next visit.
3. On staging, a super-admin turns « Espace coach v2 » on in Paramètres › Environnement, and the browser acceptance matrix below is run. Then in production, after the product owner's go.
4. The PR of #888 moves the Release Note fragments of `docs/ops/human-coach-888-release-notes/` back into `packages/help/releases/unreleased/`, and the `reserver-seance-coach` Motion Script's new version in its place. The motion is rendered again.
5. A later change removes the former Coach space, the legacy code paths kept for « off », the Help Articles' `requires: coach-space-v2` and the setting itself, and makes the coach-v2 project part of the web project.

## Review and integration

Historical PRs 948–971 preserve independent review slices. The final epic PR targets current main directly and is intended for the repository’s squash-only merge rule. Do not merge the historical stack in sequence. Keep its pinned review references when resolving integration conflicts, and request independent review of the final integration delta.

Before any requested staging deployment, run the Coach workspace, contract, enrolment, Association, profile moderation, Connect, earnings, Cal booking, cancellation, reminders and content-report browser suites, plus the module/privacy/type/build checks. Review both themes and desktop/tablet/390px navigation. The `reserver-seance-coach` script describes the current order, integrated booking and Join windows; regenerate its recording after the activation prerequisites and demo payment recipient are ready. An old recording must not be treated as evidence of the new booking behavior.

## Remaining human and environment gates

At this delivery stage no approved legal versions for #889, #890 or #518 are supplied. No deployment or live activation has been authorized; merging is safe because « Espace coach v2 » stays off. The official DGFiP 2026 schema archive is also unavailable under the current environment network policy; fiscal structural readiness and copy notifications fail closed until its real import and positive individual/entity validation. See `coaching-tax.md`. Actual tax filing, provider procurement, professional due diligence and acknowledgement retention remain human operations.

Staging acceptance requires an explicitly authorized deployment of the reviewed consolidated commit, real publication/credential/provider readiness and the browser acceptance matrix. The earlier unrelated staging deployment at 7081fea does not contain this epic and supplies no evidence that these routes are active there.
