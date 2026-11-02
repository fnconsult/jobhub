# Test Motion Scripts

Two Motion Scripts the `motions` workflow renders when run with « fixtures » (#567), and that `e2e/motions.spec.ts` films:

- `essai-candidatures`: the demo Candidate's « Mes candidatures », then one Application, in French and in English;
- `essai-capture-cassee`: its second step clicks a button no page has, so its capture breaks: the run keeps the
  previous video and warns in its summary.

They are no Tutorial's: the real scripts live in `packages/help/motions/` (#570).
