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
import { REPLY_MAX_LENGTH, SIGNALEMENT_STATUSES } from "@/signalements/values";
import "../../section.css";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ fait?: string; erreur?: string }> };

/** What the page says after a change: done, or why not. */
const DONE = ["status", "reply"] as const;
const ERRORS = ["reply_required", "already_handled", "not_found", "required", "too_long", "invalid"] as const;
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

/**
 * One Signalement (#376): its full message, its context and, for a Question, the question asked to the AI Coach and its
 * reply; for Support and super-admins the Candidate's email and Plan, its status buttons and the team's reply. Opening
 * it changes nothing. Help editors open the Questions alone, read-only, without who sent them.
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

        <Card title={t("admin.signalements.statusTitle")}>
          <div className="section-block">
            <p>{t("admin.signalements.statusNow", { status: t(`admin.signalements.statuses.${signalement.status}`) })}</p>
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
