// Runs the worker's "push-notifications.send" job once, as the queue would hand it a notification, with fake APNs and
// FCM providers in place of Apple's and Google's: `tsx e2e/support/push-send.ts <email> <event> [mode]`.
//   mode "fake" (default): a token containing "invalid" is refused as unknown to its provider, any other is delivered;
//   mode "no-keys": no key entered, as the worker runs before the Provider Secrets are.
// Prints one JSON line: { result, messages } with the messages the providers were handed (title, body, path, language).
import pg from "pg";
import { createJobs } from "../../apps/worker/src/jobs";
import { createPushNotifications, PUSH_NOTIFICATIONS_QUEUE, type PushSender } from "../../apps/web/src/push-notifications";

const [email, event, mode = "fake"] = process.argv.slice(2);
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const messages: object[] = [];
const sender: PushSender = {
  async send(device, message) {
    if (device.token.includes("invalid")) return { ok: false, reason: "device_token_invalid", tokenInvalid: true, status: 410, message: `Unregistered ${device.token}` };
    messages.push(message);
    return { ok: true };
  },
};
const lines: string[] = [];
const pushNotifications = createPushNotifications(database, { senders: () => (mode === "no-keys" ? {} : { ios: sender, android: sender }), log: (line) => lines.push(line) });
try {
  const { rows } = await database.query<{ id: string }>(`SELECT id FROM candidate WHERE lower(email) = lower($1)`, [email]);
  if (!rows[0]) throw new Error(`no account for ${email}`);
  const notification = { event, jobSearchId: "js_1", jobDigestId: "jd_1", applicationId: "app_1", candidateId: "cand_1", sessionId: "session_1", noticeKey: "a".repeat(64) };
  const job = createJobs({ database, pushNotifications })[PUSH_NOTIFICATIONS_QUEUE]!;
  const before = await database.query(`SELECT count(*)::int AS n FROM push_device WHERE candidate_id = $1`, [rows[0].id]);
  await job.handler({ personId: rows[0].id, notification });
  const after = await database.query(`SELECT count(*)::int AS n FROM push_device WHERE candidate_id = $1`, [rows[0].id]);
  console.log(JSON.stringify({ before: before.rows[0].n, after: after.rows[0].n, messages, log: lines }));
} finally {
  await database.end();
}
