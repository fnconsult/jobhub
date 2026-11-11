# Human Coach epic review record (#867)

The historical slices below were independently reviewed at pinned commits by the Astra review agent. Findings were corrected and re-reviewed. The delivery branch integrates main 7081fea; historical stack PRs are references, not a sequence to merge. The repository’s final merge must be a squash of the consolidated PR after human approval.

| Tickets | Implementation and review references |
| --- | --- |
| #868, #869, #870, #871, #882, #884 | #948 workspace, privacy/access, sessions, time zones and Join; #952 review corrections |
| #872 | #949 session reports |
| #873 | #950 Shared Reading; #952 timed-boundary/contact corrections |
| #874 | #951 offers/Sellers; #952 atomic paid snapshot and commission-audit corrections |
| #875 | #953 enrolment; #954 independent notification retry |
| #876 | #956 Associations; #957 verified-email financial export |
| #877 | #958 moderated profile and portrait versions |
| #878 | #959 Connect; #960 recovery/settlement; #961 unsettled-balance hold |
| #879 | #962 earnings and private statements |
| #880 | #955 private B2B contract acceptance and isolated test seam |
| #881 | #963 team booking; #964 causal recovery/duration guard; #965 unavailable-chain cancellation |
| #883 | #966 financial refund entitlements; #967 cancellation choices; #968 delivery checkpoints/retained Support debts and navigation |
| #885 | #969 lifecycle notices, reminders and private settings |
| #886 | #970 content reports, audited decisions and restrictions |
| #887 | #971 encrypted fiscal identities and annual preparation; original-year cutoff fix. Official XSD compatibility remains unverified and blocked. |
| #888 | #972 permanent workspace, legacy removal, Help/motion rewrite. Actual staging activation remains outstanding. |

The local Coach browser acceptance matrix covers 21 scenarios across enrolment, contract gating, Association isolation, profile moderation, signed booking, Connect fiscal onboarding, refunds, earnings, reminders, content reports, regular-account refusal, Coach Access/reviews, time zones, private notes, Shared Reading and reports. The final corrected workspace checks include nine pages in both themes at 1280/1024/390px. No test was skipped to obtain these results: obsolete pre-epic UI expectations were replaced by current workspace scenarios and dedicated payment/booking/cancellation suites. Workspace fixtures start with already-paid services; actual purchases remain exercised by Connect/booking tests.

The slice validation includes 39 workspace/settings/reminder checks, 55 legal/contract/push checks, 2 date-dialog regressions and 15 DAC7 tests, plus the module/privacy checks recorded in each PR. Integrated full-repository checks and their final result are recorded in the consolidated PR. Test preloads are synthetic, deliberate and confined to the harness; zero approved legal versions are supplied by this implementation.

## Acceptance boundaries still open

- #887: retrieve the real official DGFiP 2026 archive, record its source/hash, import it and pass positive individual/entity XML validation. Current network policy denies the origin. Production XML readiness and fiscal-copy notices remain closed without the bundle. Filed-return corrections and actual tax filing require the authorized operator.
- #888: no epic staging deployment or activation has been performed or authorized. Human #889/#890/#518 texts, actual provider credentials/team configuration, reminder shutdown confirmation, publication observation and due diligence must be completed. The unrelated staging deployment at 7081fea contains none of this epic.
- The required booking-motion source is rewritten and flagged for regeneration. A recording of the activated booking flow requires its real activation/demo payment prerequisites; an old recording does not validate the new flow.

These are explicit external acceptance boundaries, not successful production activation or authoritative legal approval.
