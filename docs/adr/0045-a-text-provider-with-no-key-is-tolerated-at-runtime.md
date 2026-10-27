# A text provider with no key is tolerated at runtime and fails only its own calls

ADR-0033 refused an AI route on save when its provider's key was missing, and start-up stopped on it. With keys now held in the Back Office (ADR-0042), a super-admin routes a task before pasting the key, and one missing key took down every AI task of the web app and the worker. #402 amends this in line with ADR-0042's "a provider with no key can be chosen, with a warning".

- **Runtime**: the web app's and the worker's AI layer are built with `tolerateMissingKeys`. A text task routed to a provider with no key makes only that task's calls fail, recorded as `key_missing`; the other tasks run. A missing Search provider key stays as ADR-0043 and #399 decided.
- **Save**: `checkAiRoutingChange` no longer refuses such a route and does not test-call its model; the panel warns (« clé absente ») and saves anyway. A route missing, a personal-data task outside the EU and a failed model test still refuse.
- **Without the option** (`createAiLayerFromEnv` default), start-up still stops on a missing key.
- **Country**: a Platform Setting value kind of its own, a two-letter code kept in upper case, for `JOB_DISCOVERY_COUNTRY`.

This amends ADR-0033 ("key missing refused on save").

## Considered Options

- **Keep refusing**: forces the key before the route, which the Back Office's order of work (choose, then paste, then test) makes awkward.
- **Fall back to another provider**: hides a misconfiguration and may send data to a provider the super-admin did not choose.
