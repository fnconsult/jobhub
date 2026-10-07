type Env = Record<string, string | undefined>;

/**
 * Administrators: Jobbbox team members who run the back office. They sign in
 * like Candidates; their email addresses are listed in ADMIN_EMAILS (ADR-0014).
 */
export function administratorsFromEnv(env: Env) {
  const emails = new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  return (person: { email: string; emailVerified: boolean }): boolean =>
    person.emailVerified && emails.has(person.email.trim().toLowerCase());
}
