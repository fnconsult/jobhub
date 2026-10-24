import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUnansweredQuestionsBackOffice, requireBackOffice } from "@/admin/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { UNANSWERED_QUESTION_LANGUAGES, type UnansweredQuestionLanguage, type UnansweredQuestionMark } from "@/unanswered-questions";
import { getUnansweredQuestions } from "@/unanswered-questions/server";

const CURRENT = "page";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to those whose roles do not cover it would carry its title.
  await requireBackOffice("unansweredQuestions");
  const t = await getServerT();
  return { title: `${t("admin.unansweredQuestions.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** « Article écrit » or « Écarter »: Help editors and super-admins only, each in the Back Office Audit. */
async function mark(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("unansweredQuestions", "write");
  const status = form.get("status");
  const marked = await getUnansweredQuestionsBackOffice().mark(administrator, String(form.get("id")), status);
  const back = routes.adminUnansweredQuestions({ route: String(form.get("route") ?? ""), language: String(form.get("language") ?? "") });
  redirect(`${back}${back.includes("?") ? "&" : "?"}${marked ? `marque=${String(status)}` : "erreur=1"}`);
}

/** The two marks, each its button's words and its name with the question, so each row's buttons are told apart. */
const MARKS = [
  { status: "written", label: "admin.unansweredQuestions.markWritten", named: "admin.unansweredQuestions.markWrittenLabel" },
  { status: "dismissed", label: "admin.unansweredQuestions.dismiss", named: "admin.unansweredQuestions.dismissLabel" },
] as const satisfies ReadonlyArray<{ status: UnansweredQuestionMark; label: string; named: string }>;

const isLanguage = (value: unknown): value is UnansweredQuestionLanguage => UNANSWERED_QUESTION_LANGUAGES.includes(value as UnansweredQuestionLanguage);

/**
 * « Questions sans réponse » (#344, ADR-0035): the questions about using Jobbbox the help missed, most asked first,
 * by page and by language, each with what the AI Coach answered. Help editors and super-admins mark one « Article écrit »
 * or « Écarter »; Support reads them.
 */
export default async function UnansweredQuestionsPage({ searchParams }: { searchParams: Promise<{ page?: string; langue?: string; marque?: string; erreur?: string }> }) {
  const { access, canWrite } = await requireBackOffice("unansweredQuestions");
  const t = await getServerT();
  const locale = await getRequestLocale();
  const { page: route, langue, marque, erreur } = await searchParams;
  const language = isLanguage(langue) ? langue : undefined;
  const all = await getUnansweredQuestions().open();
  const shown = await getUnansweredQuestions().open({ ...(route ? { route } : {}), ...(language ? { language } : {}) });
  const pages = [...new Set(all.flatMap((each) => (each.route ? [each.route] : [])))].sort();
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const number = new Intl.NumberFormat(locale);
  const when = (date: Date) => <time dateTime={date.toISOString()}>{at.format(date)}</time>;

  return (
    <BackOfficeLayout access={access} title={t("admin.unansweredQuestions.title")}>
      <p className="lead">{t("admin.unansweredQuestions.intro")}</p>
      <p>{t("admin.unansweredQuestions.privacy")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {marque === "written" || marque === "dismissed" ? (
        <p className="notice" role="status">
          {t(`admin.unansweredQuestions.marked.${marque}`)}
        </p>
      ) : null}
      {erreur ? (
        <p className="notice" role="alert">
          {t("admin.unansweredQuestions.notMarked")}
        </p>
      ) : null}

      <nav aria-label={t("admin.unansweredQuestions.routeFilter")}>
        <ul className="journal-filter">
          {[undefined, ...pages].map((option) => (
            <li key={option ?? "all"}>
              <Link href={routes.adminUnansweredQuestions({ ...(option ? { route: option } : {}), ...(language ? { language } : {}) })} aria-current={option === route ? CURRENT : undefined}>
                {option ?? t("admin.unansweredQuestions.allRoutes")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label={t("admin.unansweredQuestions.languageFilter")}>
        <ul className="journal-filter">
          {[undefined, ...UNANSWERED_QUESTION_LANGUAGES].map((option) => (
            <li key={option ?? "all"}>
              <Link href={routes.adminUnansweredQuestions({ ...(route ? { route } : {}), ...(option ? { language: option } : {}) })} aria-current={option === language ? CURRENT : undefined}>
                {option ? t(`admin.unansweredQuestions.languages.${option}`) : t("admin.unansweredQuestions.allLanguages")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {shown.length === 0 ? (
        <p>{t("admin.unansweredQuestions.none")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.unansweredQuestions.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.unansweredQuestions.question")}</th>
                <th scope="col">{t("admin.unansweredQuestions.route")}</th>
                <th scope="col">{t("admin.unansweredQuestions.count")}</th>
                <th scope="col">{t("admin.unansweredQuestions.firstAskedAt")}</th>
                <th scope="col">{t("admin.unansweredQuestions.lastAskedAt")}</th>
                <th scope="col">{t("admin.unansweredQuestions.answer")}</th>
                <th scope="col">{t("admin.unansweredQuestions.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((each) => (
                <tr key={each.id}>
                  <th scope="row" lang={each.language}>
                    {each.question}
                  </th>
                  <td>
                    {each.route ? <code>{each.route}</code> : t("admin.unansweredQuestions.unknownRoute")} · {t(`admin.unansweredQuestions.languages.${each.language}`)}
                  </td>
                  <td>{number.format(each.count)}</td>
                  <td>{when(each.firstAskedAt)}</td>
                  <td>{when(each.lastAskedAt)}</td>
                  <td>
                    <details>
                      <summary>{t("admin.unansweredQuestions.answer")}</summary>
                      <p lang={each.language} className="unanswered-answer">
                        {each.answer}
                      </p>
                    </details>
                  </td>
                  <td>
                    <BackOfficeForm canWrite={canWrite} action={mark} className="actions">
                      <input type="hidden" name="id" value={each.id} />
                      <input type="hidden" name="route" value={route ?? ""} />
                      <input type="hidden" name="language" value={language ?? ""} />
                      {MARKS.map(({ status, label, named }) => (
                        <button key={status} className="button" type="submit" name="status" value={status} disabled={!canWrite} aria-label={t(named, { question: each.question })}>
                          {t(label)}
                        </button>
                      ))}
                    </BackOfficeForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BackOfficeLayout>
  );
}
