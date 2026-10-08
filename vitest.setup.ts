import { afterAll } from "vitest";
import { dropLeftoverThrowawayDatabases } from "./apps/web/src/test-support/throwaway-database";

// A hook that timed out on a loaded Postgres can still be creating a
// throwaway database when its test is over: drop whatever the file left.
afterAll(dropLeftoverThrowawayDatabases);
