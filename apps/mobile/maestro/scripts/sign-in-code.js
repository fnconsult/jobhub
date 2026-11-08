// The code of the run's Candidate's newest sign-in email, from the seeded stack's helper (e2e/mobile-stack.spec.ts),
// which waits for it. Maestro's JavaScript: `http`, `json` and `output` are its own; STACK_URL and STACK_EMAIL its env.
const response = http.get(`${STACK_URL}/sign-in-code?email=${encodeURIComponent(STACK_EMAIL)}`);
if (!response.ok) throw new Error(`no sign-in code for ${STACK_EMAIL}: ${response.status} ${response.body}`);
output.signInCode = json(response.body).code;
