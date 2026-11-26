import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSignalementsBackOffice, requireBackOffice } from "@/admin/server";
import { getBilling } from "@/billing/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, Textarea } from "@/design/Field";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { signatureName } from "@/agent-keys/values";
import { issueUrl } from "@/signalements/server";
import { DRAFT_LANGUAGES, REPLY_MAX_LENGTH, SIGNALEMENT_STATUSES } from "@/signalements/values";
import "../../section.css";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ fait?: string; erreur?: string }> };

/** What the page says after a change: done, or why not. */
const DONE = ["status", "reply", "draftSaved", "draftSent", "draftRemoved"] as const;
const ERRORS = ["reply_required", "already_handled", "not_found", "required", "too_long", "invalid", "no_draft"] as const;
type Done = (typeof DONE)[number];
type Refused = (typeof ERRORS)[number];
const isDone = (value: unknown): value is Done => DONE.includes(value as Done);
const isRefused = (value: unknown): value is Refused => ERRORS.includes(value as Refused);

export async function generateMetadata(): Promise<Metadata> {
  await requireBackOffice("signalements");
  const t = await getServerT();
  return { title: `${t("admin.signalements.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const back = (id: string, outcome: { fait: Done } | { erreur: Refused }) => `${routes.adminSignalement(id)}?${new URLSearchParams(outcome).toString()}`;

/** Nouveau, vu or traité, in any direction: Support and super-admins only, each in the Back Office Audit. */
async function changeStatus(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("signalements", "write");
  const id = String(form.get("id"));
  const done = await getSignalementsBackOffice().changeStatus(administrator, id, form.get("status"));
  redirect(back(id, done.ok ? { fait: "status" } : { erreur: done.error }));
}

/** The team's one reply, until it is traité: Support and super-admins only, in the Back Office Audit without its words. */
async function reply(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("signalements", "write");
  const id = String(form.get("id"));
  const done = await getSignalementsBackOffice().reply(administrator, id, form.get("reply"));
  const error = done.ok ? null : "errors" in done ? done.errors[0]!.code : done.error;
  redirect(back(id, error === null ? { fait: "reply" } : { erreur: isRefused(error) ? error : "invalid" }));
}

/** What Support edits of the draft reply: its French and English versions, as the form holds them. */
const draftOf = (form: FormData) => ({ fr: form.get("fr"), en: form.get("en") });

const draftError = (done: { ok: false; error: string } | { ok: false; errors: { code: string }[] }): Refused => {
  const error = "errors" in done ? done.errors[0]!.code : done.error;
  return isRefused(error) ? error : "invalid";
};

/** Saves Support's edit of the draft reply, keeping who proposed it (#1141). Not in the Back Office Audit. */
async function saveDraft(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("signalements", "write");
  const id = String(form.get("id"));
  const done = await getSignalementsBackOffice().saveDraft(administrator, id, draftOf(form));
  redirect(back(id, done.ok ? { fait: "draftSaved" } : { erreur: draftError(done) }));
}

/**
 * Sends the draft reply as edited (#1141): the Candidate gets the version in their language, signed « L'équipe
 * Jobbbox », and « traité » with it, in one notification. In the Back Office Audit, without its words.
 */
async function sendDraft(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("signalements", "write");
  const id = String(form.get("id"));
  const done = await getSignalementsBackOffice().sendDraft(administrator, id, draftOf(form));
  redirect(back(id, done.ok ? { fait: "draftSent" } : { erreur: draftError(done) }));
}

/** Deletes the draft reply (#1141). Not in the Back Office Audit. */
async function removeDraft(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("signalements", "write");
  const id = String(form.get("id"));
  const done = await getSignalementsBackOffice().removeDraft(administrator, id);
  redirect(back(id, done.ok ? { fait: "draftRemoved" } : { erreur: done.error }));
}

/**
 * One Signalement (#376): its full message, its context and, for a Question, the question asked to the AI Coach and its
 * reply; for Support and super-admins the Candidate's email and Plan, its status buttons and the team's reply. Opening
 * it changes nothing. Help editors open the Questions alone, read-only, without who sent them.
 * For the team alone (#1141): the issues Signalement triage had Jobbbox publish or comment, « Prêt à clore » once its fix
 * is deployed, and the draft reply an Agent Key proposed, which Support edits, sends or deletes.
 */
export default async function SignalementPage({ params, searchParams }: Params) {
  const { access, canWrite } = await requireBackOffice("signalements");
  const signalement = await getSignalementsBackOffice().open(access, (await params).id);
  if (!signalement) notFound();
  const { fait, erreur } = await searchParams;
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const plans = signalement.candidate ? await getBilling().plans() : [];
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const type = t(`admin.signalements.types.${signalement.type}`);
  const handled = signalement.status === "traite";
  const { context } = signalement;

  return (
    <BackOfficeLayout access={access} title={t("admin.signalements.detailTitle", { type, date: at.format(signalement.createdAt) })}>
      <div className="section-page">
        <p>
          <Link href={routes.adminSignalements()}>{t("admin.signalements.back")}</Link>
        </p>
        {canWrite ? null : <Note>{t("admin.readOnly")}</Note>}
        {isDone(fait) ? (
          <Note tone="success" role="status">
            {t(`admin.signalements.notices.${fait}`)}
          </Note>
        ) : null}
        {isRefused(erreur) ? (
          <Note tone="danger" role="alert">
            {t(`admin.signalements.notices.${erreur}`)}
          </Note>
        ) : null}

        {signalement.candidate ? (
          <p>
            {t("admin.signalements.sentBy", {
              email: signalement.candidate.email,
              plan: plans.find((plan) => plan.key === signalement.candidate!.plan)?.name[locale] ?? signalement.candidate.plan,
            })}
          </p>
        ) : null}

        <Card title={t("admin.signalements.message")}>
          <div className="section-block">
            <p className="section-text" lang={context.interfaceLanguage}>
              {signalement.message}
            </p>
            {signalement.attachedQuestion !== null ? (
              <>
                <h3>{t("admin.signalements.attachedQuestion")}</h3>
                <p className="section-text" lang={context.interfaceLanguage}>
                  {signalement.attachedQuestion}
                </p>
                <h3>{t("admin.signalements.attachedCoachReply")}</h3>
                <p className="section-text" lang={context.interfaceLanguage}>
                  {signalement.attachedCoachReply}
                </p>
              </>
            ) : null}
          </div>
        </Card>

        <Card title={t("admin.signalements.context")}>
          <Properties>
            <Property term={t("admin.signalements.page")}>{context.path ? <code>{context.path}</code> : t("admin.signalements.unknownPage")}</Property>
            <Property term={t("admin.signalements.version")}>
              <code>{context.version}</code>
            </Property>
            <Property term={t("admin.signalements.browser")}>{context.browser ?? t("admin.signalements.unknownBrowser")}</Property>
            <Property term={t("admin.signalements.language")}>{t(`languages.${context.interfaceLanguage}`)}</Property>
            <Property term={t("admin.signalements.textSize")}>{t(`textSize.${context.textSize}`)}</Property>
          </Properties>
        </Card>

        {signalement.issues.length > 0 || signalement.readyToCloseAt ? (
          <Card title={t("admin.signalements.issuesTitle")}>
            <div className="section-block">
              {signalement.readyToCloseAt && !handled ? (
                <Note tone="success" role="status">
                  {t("admin.signalements.readyToCloseSince", { date: at.format(signalement.readyToCloseAt) })}
                </Note>
              ) : null}
              <ul data-issues>
                {signalement.issues.map((issue) => (
                  <li key={issue.number}>
                    <a href={issueUrl(issue.number)} target="_blank" rel="noreferrer">
                      #{issue.number}
                    </a>{" "}
                    {t(`admin.signalements.issueKinds.${issue.kind}`, { key: signatureName(issue.linkedBy) ?? issue.linkedBy, date: at.format(issue.linkedAt) })}
                  </li>
                ))}
              </ul>
              <p className="section-meta">{t("admin.signalements.issuesHelp")}</p>
            </div>
          </Card>
        ) : null}

        <Card title={t("admin.signalements.statusTitle")}>
          <div className="section-block">
            <p>{t("admin.signalements.statusNow", { status: t(`admin.signalements.statuses.${signalement.status}`) })}</p>
            {/* A status an Agent Key set (#1139): « vu par triage-beta ». */}
            {signatureName(signalement.statusChangedBy) ? <p data-status-by>{t("admin.signalements.seenBy", { name: signatureName(signalement.statusChangedBy) })}</p> : null}
            <p className="section-meta">{t("admin.signalements.statusHelp")}</p>
            <BackOfficeForm canWrite={canWrite} action={changeStatus} className="section-actions">
              <input type="hidden" name="id" value={signalement.id} />
              {SIGNALEMENT_STATUSES.map((status) => (
                <button
                  key={status}
                  className={buttonClass({ variant: status === signalement.status ? "primary" : "secondary" })}
                  type="submit"
                  name="status"
                  value={status}
                  disabled={!canWrite}
                  aria-pressed={status === signalement.status}
                >
                  {t("admin.signalements.markAs", { status: t(`admin.signalements.statuses.${status}`) })}
                </button>
              ))}
            </BackOfficeForm>
          </div>
        </Card>

        {signalement.draft && !handled ? (
          <Card title={t("admin.signalements.draftTitle")}>
            <div className="section-block" data-draft>
              <p>
                {signalement.draft.proposedBy
                  ? t("admin.signalements.draftProposedBy", { key: signatureName(signalement.draft.proposedBy) ?? signalement.draft.proposedBy, date: at.format(signalement.draft.proposedAt) })
                  : t("admin.signalements.draftWritten", { date: at.format(signalement.draft.proposedAt) })}
                {signalement.draft.editedAt ? ` ${t("admin.signalements.draftEdited", { date: at.format(signalement.draft.editedAt) })}` : ""}
              </p>
              <p id="draft-help" className="section-meta">
                {t("admin.signalements.draftHelp", { language: t(`languages.${context.interfaceLanguage}`) })}
              </p>
              <BackOfficeForm canWrite={canWrite} action={saveDraft}>
                <fieldset className="section-form" disabled={!canWrite}>
                  <legend className="visually-hidden">{t("admin.signalements.draftTitle")}</legend>
                  <input type="hidden" name="id" value={signalement.id} />
                  {DRAFT_LANGUAGES.map((language) => (
                    <Field
                      key={language}
                      label={t(language === context.interfaceLanguage ? "admin.signalements.draftSentVersion" : "admin.signalements.draftTranslation", { language: t(`languages.${language}`) })}
                      hint={language === context.interfaceLanguage ? `— ${t("admin.signalements.signature")}` : undefined}
                    >
                      <Textarea name={language} lang={language} rows={6} required maxLength={REPLY_MAX_LENGTH} defaultValue={signalement.draft![language]} aria-describedby="draft-help" />
                    </Field>
                  ))}
                  <div className="section-actions">
                    <button className={buttonClass({ variant: "primary" })} type="submit" formAction={sendDraft}>
                      {t("admin.signalements.sendDraft")}
                    </button>
                    <button className={buttonClass({ variant: "secondary" })} type="submit">
                      {t("admin.signalements.saveDraft")}
                    </button>
                  </div>
                </fieldset>
              </BackOfficeForm>
              <BackOfficeForm canWrite={canWrite} action={removeDraft}>
                <input type="hidden" name="id" value={signalement.id} />
                <button className={buttonClass({ variant: "secondary" })} type="submit" disabled={!canWrite}>
                  {t("admin.signalements.removeDraft")}
                </button>
              </BackOfficeForm>
            </div>
          </Card>
        ) : null}

        <Card title={t("admin.signalements.replyTitle")}>
          <div className="section-block">
            <p id="reply-help">{t("admin.signalements.replyHelp")}</p>
            {handled ? (
              <>
                <p>{t("admin.signalements.replyLocked")}</p>
                {signalement.reply ? (
                  <blockquote className="section-text" lang={context.interfaceLanguage}>
                    <p>{signalement.reply}</p>
                    <footer>{t("admin.signalements.signature")}</footer>
                  </blockquote>
                ) : (
                  <p>{t("admin.signalements.noReply")}</p>
                )}
              </>
            ) : (
              <BackOfficeForm canWrite={canWrite} action={reply}>
                <fieldset className="section-form" disabled={!canWrite}>
                  <legend className="visually-hidden">{t("admin.signalements.replyTitle")}</legend>
                  <input type="hidden" name="id" value={signalement.id} />
                  <Field label={t("admin.signalements.replyTitle")} hint={`— ${t("admin.signalements.signature")}`}>
                    <Textarea name="reply" rows={6} required maxLength={REPLY_MAX_LENGTH} defaultValue={signalement.reply ?? ""} aria-describedby="reply-help" />
                  </Field>
                  <button className={buttonClass({ variant: "primary" })} type="submit">
                    {t("admin.signalements.saveReply")}
                  </button>
                </fieldset>
              </BackOfficeForm>
            )}
          </div>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
