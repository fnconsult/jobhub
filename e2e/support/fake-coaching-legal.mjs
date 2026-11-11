// E2E ONLY. Synthetic rollout coverage, deliberately preloaded outside the standalone application.
// This is not legal wording or an approval, and the application ignores it in production/staging.
globalThis[Symbol.for("jobbbox.e2e.coaching-legal")]=["cgv","confidentialite","contrat-coach"].map(text=>({text,version:"2026-01-01",url:"/test-only-no-legal-validity",sha256:"e".repeat(64),change:"substantielle",coachingCapabilities:["stripe-connect","marketplace","dac7"]}));
