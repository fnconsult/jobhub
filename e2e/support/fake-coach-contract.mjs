// Synthetic data for automated tests only. This file is not traced into the standalone application.
// Deliberately loaded through NODE_OPTIONS by tests; ignored by the app unless JOBHUB_TARGET=e2e.
const version = "2026-01-01",
  sha256 = "e".repeat(64);
const record = { text: "contrat-coach", version, url: `/espace-coach/contrat/versions/${version}`, sha256, change: "substantielle" };
const written = (locale) => [
  {
    text: "contrat-coach",
    locale,
    effective: version,
    title: "E2E FIXTURE — NO LEGAL VALIDITY",
    change: "substantielle",
    approvedBy: "E2E fixture only",
    summary: "Automated test fixture only.",
    inBrief: [],
    sections: [
      {
        id: "fixture",
        number: 1,
        title: "Test fixture",
        body: "Synthetic text for automated acceptance tests. This is not a contract and has no legal validity.",
      },
    ],
  },
];
globalThis[Symbol.for("jobbbox.e2e.coach-contract")] = { registry: [record], written: { fr: written("fr"), en: written("en") } };
