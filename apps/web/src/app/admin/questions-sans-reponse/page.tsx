import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { IntroPage } from "@/admin/page-intro";
import { getUnansweredQuestionsBackOffice, requireBackOffice } from "@/admin/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { Button } from "@/design/Button";
import { buttonClass } from "@/design/button-class";
import { Drawer } from "@/design/Drawer";
import { FilterLinks } from "@/design/FilterLinks";
import { Note } from "@/design/Note";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { UNANSWERED_QUESTION_LANGUAGES, type UnansweredQuestionLanguage, type UnansweredQuestionMark } from "@/unanswered-questions";
import { getUnansweredQuestions } from "@/unanswered-questions/server";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "unansweredQuestions";

/** The filters' id for « Toutes », which the address leaves out. */
const ALL = "all";

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
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.unansweredQuestions.title")}>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {marque === "written" || marque === "dismissed" ? (
          <Note tone="success" role="status">
            {t(`admin.unansweredQuestions.marked.${marque}`)}
          </Note>
        ) : null}
        {erreur ? (
          <Note tone="danger" role="alert">
            {t("admin.unansweredQuestions.notMarked")}
          </Note>
        ) : null}

        <FilterLinks
          label={t("admin.unansweredQuestions.routeFilter")}
          shown={route ?? ALL}
          links={[undefined, ...pages].map((option) => ({
            id: option ?? ALL,
            href: routes.adminUnansweredQuestions({ ...(option ? { route: option } : {}), ...(language ? { language } : {}) }),
            label: option ?? t("admin.unansweredQuestions.allRoutes"),
          }))}
        />
        <FilterLinks
          label={t("admin.unansweredQuestions.languageFilter")}
          shown={language ?? ALL}
          links={[undefined, ...UNANSWERED_QUESTION_LANGUAGES].map((option) => ({
            id: option ?? ALL,
            href: routes.adminUnansweredQuestions({ ...(route ? { route } : {}), ...(option ? { language: option } : {}) }),
            label: option ? t(`admin.unansweredQuestions.languages.${option}`) : t("admin.unansweredQuestions.allLanguages"),
          }))}
        />

        {shown.length === 0 ? (
          <p>{t("admin.unansweredQuestions.none")}</p>
        ) : (
          <Table
            label={t("admin.unansweredQuestions.caption")}
            columns={[
              {
                header: t("admin.unansweredQuestions.question"),
                rowHeader: true,
                cell: (each) => <span lang={each.language}>{each.question}</span>,
              },
              {
                header: t("admin.unansweredQuestions.route"),
                cell: (each) => (
                  <>
                    {each.route ? <code>{each.route}</code> : t("admin.unansweredQuestions.unknownRoute")} · {t(`admin.unansweredQuestions.languages.${each.language}`)}
                  </>
                ),
              },
              { header: t("admin.unansweredQuestions.count"), numeric: true, cell: (each) => number.format(each.count) },
              { header: t("admin.unansweredQuestions.firstAskedAt"), cell: (each) => when(each.firstAskedAt) },
              { header: t("admin.unansweredQuestions.lastAskedAt"), cell: (each) => when(each.lastAskedAt) },
              {
                header: t("admin.unansweredQuestions.answer"),
                // The AI Coach's answer on demand, in a Drawer: the table stays one line per question.
                cell: (each) => (
                  <Drawer
                    title={<span lang={each.language}>{each.question}</span>}
                    trigger={
                      <Button size="sm" aria-label={t("admin.unansweredQuestions.answerOf", { question: each.question })}>
                        {t("admin.unansweredQuestions.answer")}
                      </Button>
                    }
                  >
                    <h3>{t("admin.unansweredQuestions.answer")}</h3>
                    <p lang={each.language} className="section-text">
                      {each.answer}
                    </p>
                  </Drawer>
                ),
              },
              {
                header: t("admin.unansweredQuestions.actions"),
                cell: (each) => (
                  <BackOfficeForm canWrite={canWrite} action={mark} className="section-actions">
                    <input type="hidden" name="id" value={each.id} />
                    <input type="hidden" name="route" value={route ?? ""} />
                    <input type="hidden" name="language" value={language ?? ""} />
                    {MARKS.map(({ status, label, named }) => (
                      <button
                        key={status}
                        className={buttonClass({ size: "sm" })}
                        type="submit"
                        name="status"
                        value={status}
                        disabled={!canWrite}
                        aria-label={t(named, { question: each.question })}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </BackOfficeForm>
                ),
              },
            ]}
            rows={shown}
            rowKey={(each) => each.id}
          />
        )}
      </div>
    </BackOfficeLayout>
  );
}
