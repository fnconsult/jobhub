import pg from "pg";

/** Drops the e2e web server's throwaway database. */
export default async function globalTeardown() {
  const url = new URL(process.env.E2E_DATABASE_URL!);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
