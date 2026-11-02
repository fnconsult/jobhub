import { NextResponse } from "next/server";
import * as z from "zod";
import { backOfficeAdministrator } from "@/admin/server";
import { isFromTrustedOrigin } from "@/auth/server";
import { MAX_MESSAGE_LENGTH } from "@/back-office-assistant/conversation";
import { UNANSWERED_QUESTION_LANGUAGES } from "@/unanswered-questions";
import { getUnansweredQuestions } from "@/unanswered-questions/server";

/** The Back Office Assistant's reply kept with the request, at most (the Unanswered Question keeps 4,000 characters of it). */
const MAX_ANSWER_LENGTH = 100_000;

const bodySchema = z.object({
  question: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  answer: z.string().max(MAX_ANSWER_LENGTH),
  route: z.string().max(2_000).nullish(),
  language: z.enum(UNANSWERED_QUESTION_LANGUAGES),
});

/**
 * « Demander un tutoriel » (#551, ADR-0065): an Administrator's question the Back Office Assistant found no Help Article
 * for, kept as an Unanswered Question of the `administrator` audience with the Back Office section in view (its route
 * pattern) and the language, never the Administrator: their id is checked here and passed on nowhere. Only this click
 * records one.
 * Body: { question, answer, route?, language }.
 * 201 { recorded: true } · 400 { error: "invalid" } · 403 · 404 (not an Administrator)
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await backOfficeAdministrator())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const recorded = await getUnansweredQuestions().request(parsed.data);
  return recorded ? NextResponse.json({ recorded: true }, { status: 201 }) : NextResponse.json({ error: "invalid" }, { status: 400 });
}
