import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getGuardrailsBackOffice, requireBackOffice } from "@/admin/server";
import { getCurrentCandidate } from "@/auth/server";
import { playbookServing } from "@/coaching-playbooks/serving";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, Select, Textarea, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill, type Tone } from "@/design/Pill";
import { Properties, Property } from "@/design/Properties";
import { Table } from "@/design/Table";
import { getEvals } from "@/evals/server";
import { GUARDRAIL_LANGUAGES, type GuardrailId, type GuardrailLanguage, type GuardrailSetting } from "@/guardrails";
import { GUARDRAIL_FAILURE_REASONS } from "@jobhub/shared";
import { getGuardrailStore, guardrailTriggersOfLastDays } from "@/guardrails/server";
import { TRIGGER_RETENTION_MONTHS, type GuardrailMessageVersion, type GuardrailTriggerDay } from "@/guardrails/store";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import Link from "next/link";
import { EvalRunsTable } from "../evaluations/run-views";
import "../section.css";

/** What the page says after an action: a key under admin.guardrails.notices, and whether it is an error. */
const NOTICES = {
  settingSaved: false,
  messageSaved: false,
  validated: false,
  unchanged: false,
  invalid: true,
  always_on: true,
  not_found: true,
  helpline_missing: true,
  own_message: true,
  already_validated: true,
  not_latest: true,
  nameRequired: true,
  eval_refused: true,
} as const;
type Notice = keyof typeof NOTICES;
/** A Guardrail's setting, its words saying it: blocking is on, flagging watches, off stands out. */
const SETTING_TONE: Record<GuardrailSetting, Tone> = { block: "success", flag: "accent", off: "warn" };
const isNotice = (value: unknown): value is Notice => typeof value === "string" && Object.hasOwn(NOTICES, value);

/** How many days of Guardrail Triggers the page shows. */
const TRIGGER_DAYS = 30;

/** The reasons a day's unavailable checks are counted under, in this order; `unrecorded` last (#261). */
const UNAVAILABLE_REASONS = [...GUARDRAIL_FAILURE_REASONS, "unrecorded"] as const satisfies readonly (keyof GuardrailTriggerDay["unavailableBy"])[];

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("guardrails");
  const t = await getServerT();
  return { title: `${t("admin.guardrails.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** `run`: the Eval Run a setting was played on; `cases`: what it let through. */
const back = (notice: Notice, anchor?: string, extra: Record<string, string> = {}): never =>
  redirect(`${routes.adminGuardrails}?${new URLSearchParams({ notice, ...extra })}${anchor ? `#${anchor}` : ""}`);

/** A new setting is saved only after the Guardrails' Eval Cases are played on it (ADR-0023, #231). */
async function saveSetting(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("guardrails", "write");
  const id = String(form.get("guardrail"));
  const done = await getGuardrailsBackOffice().setSetting(administrator, id, form.get("setting"));
  if (done.ok) back(done.changed ? "settingSaved" : "unchanged", id, done.run ? { run: done.run.id } : {});
  else if (done.error === "eval_refused") back("eval_refused", id, { run: done.run.id, cases: done.refused.map((result) => result.case.title).join(" ; ") });
  else back(done.error, id);
}

async function saveMessage(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("guardrails", "write");
  const id = String(form.get("guardrail"));
  const saved = await getGuardrailsBackOffice().saveMessage(administrator, id, String(form.get("language")), form.get("text"));
  back(saved.ok ? "messageSaved" : saved.error, id);
}

async function validateMessage(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("guardrails", "write");
  const id = String(form.get("guardrail"));
  const name = String(form.get("name") ?? "").trim();
  if (!name) back("nameRequired", id);
  const validated = await getGuardrailsBackOffice().validateMessage({ ...administrator, name }, id, String(form.get("language")), Number(form.get("version")));
  back(validated.ok ? "validated" : validated.error, id);
}

/**
 * The Guardrails (ADR-0022, #228): fixed in code, tuned here. Super-admins set each to block or flag only
 * (distress, personal data leak and secret disclosure always block) and write its Guardrail messages,
 * which another Administrator validates; Support reads. The Guardrail Triggers, per day and per Guardrail,
 * name no one and hold no text; the unavailable checks are counted per Failure Reason (#261).
 */
export default async function GuardrailsPage({ searchParams }: { searchParams: Promise<{ notice?: string; run?: string; cases?: string }> }) {
  const { access, canWrite } = await requireBackOffice("guardrails");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { notice, run, cases } = await searchParams;
  const shown = isNotice(notice) ? notice : null;
  const [guardrails, triggers, runs] = await Promise.all([getGuardrailStore().list(), guardrailTriggersOfLastDays(TRIGGER_DAYS), getEvals().runs({ kind: "guardrails" }, 10)]);
  const accountName = (await getCurrentCandidate())?.name?.trim() ?? "";
  const readsRuns = access.can("evalRuns", "read");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Paris" });
  const number = new Intl.NumberFormat(locale);
  const validation = (message: GuardrailMessageVersion) =>
    message.validation ? t("admin.guardrails.validatedBy", { name: message.validation.name, date: date.format(message.validation.at) }) : t("admin.guardrails.notValidated");
  const name = (id: GuardrailId) => t(`admin.guardrails.names.${id}`);
  const language = (each: GuardrailLanguage) => t(`admin.guardrails.languages.${each}`);

  return (
    <BackOfficeLayout access={access} title={t("admin.guardrails.title")}>
      <div className="section-page">
        <PageIntro t={t} page="guardrails" subject={t("admin.guardrails.title")}>
          <p>{t(playbookServing(process.env) === "validated" ? "admin.guardrails.servingValidated" : "admin.guardrails.servingLatest")}</p>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {shown ? (
          <Note tone={NOTICES[shown] ? "danger" : "success"} role={NOTICES[shown] ? "alert" : "status"}>
            {t(`admin.guardrails.notices.${shown}`, { cases: cases ?? "" })}
          </Note>
        ) : null}
        {shown && run && /^[0-9a-f-]{36}$/i.test(run) ? (
          <p>
            <Link href={routes.adminEvalRun(run)}>{t("admin.guardrails.runs.played")}</Link>
          </p>
        ) : null}

        <Table
          label={t("admin.guardrails.caption")}
          columns={[
            { key: "name", header: t("admin.guardrails.name"), rowHeader: true, cell: (guardrail) => <a href={`#${guardrail.id}`}>{name(guardrail.id)}</a> },
            { key: "against", header: t("admin.guardrails.guardsAgainst"), cell: (guardrail) => t(`admin.guardrails.descriptions.${guardrail.id}`) },
            {
              key: "setting",
              header: t("admin.guardrails.setting"),
              cell: (guardrail) => <Pill tone={guardrail.alwaysOn ? "accent" : SETTING_TONE[guardrail.setting]}>{guardrail.alwaysOn ? t("admin.guardrails.alwaysOn") : t(`admin.guardrails.settings.${guardrail.setting}`)}</Pill>,
            },
          ]}
          rows={guardrails}
          rowKey={(guardrail) => guardrail.id}
        />

        {guardrails.map((guardrail) => (
          <section key={guardrail.id} id={guardrail.id} className="section-block" aria-labelledby={`${guardrail.id}-title`}>
            <h2 id={`${guardrail.id}-title`}>{name(guardrail.id)}</h2>
            <p>{t(`admin.guardrails.descriptions.${guardrail.id}`)}</p>
            {guardrail.alwaysOn ? (
              <p className="section-meta">{t("admin.guardrails.alwaysOnHelp")}</p>
            ) : (
              <BackOfficeForm canWrite={canWrite} action={saveSetting}>
                <Card>
                  <fieldset className="section-form" disabled={!canWrite}>
                    <legend>{t("admin.guardrails.setting")}</legend>
                    <input type="hidden" name="guardrail" value={guardrail.id} />
                    <Field
                      label={t("admin.guardrails.settingLabel")}
                      hint={`${t(guardrail.messages ? "admin.guardrails.settingHelp" : "admin.guardrails.settingHelpEmail")} ${t("admin.guardrails.settingHelpEvals")}`}
                    >
                      <Select name="setting" defaultValue={guardrail.setting}>
                        {guardrail.settings.map((setting) => (
                          <option key={setting} value={setting}>
                            {t(`admin.guardrails.settings.${setting}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <button className={buttonClass({ variant: "primary" })} type="submit">
                      {t("admin.guardrails.saveSetting")}
                    </button>
                  </fieldset>
                </Card>
              </BackOfficeForm>
            )}

            {guardrail.messages ? null : <p className="section-meta">{t("admin.guardrails.noMessage")}</p>}
            {GUARDRAIL_LANGUAGES.map((each) => {
              if (!guardrail.messages) return null;
              const { latest, served, default: fallback } = guardrail.messages[each];
              return (
                <Card key={each} title={t("admin.guardrails.messageTitle", { language: language(each) })} headingLevel={3}>
                  <div className="section-block">
                    <Properties>
                      <Property
                        term={t("admin.guardrails.served")}
                        lang={each}
                        meta={served ? `${t("admin.guardrails.version", { version: String(served.version) })}, ${validation(served)}` : t("admin.guardrails.defaultText")}
                      >
                        {served ? served.text : fallback}
                      </Property>
                      {latest && latest.version !== served?.version ? (
                        <Property
                          term={t("admin.guardrails.latest")}
                          lang={each}
                          meta={`${t("admin.guardrails.version", { version: String(latest.version) })}, ${t("admin.guardrails.writtenBy", { author: latest.author })}, ${validation(latest)}`}
                        >
                          {latest.text}
                        </Property>
                      ) : null}
                    </Properties>
                    {latest && !latest.validation ? (
                      <BackOfficeForm canWrite={canWrite} action={validateMessage}>
                        <fieldset className="section-form" disabled={!canWrite}>
                          <legend>{t("admin.guardrails.validateTitle", { language: language(each), version: String(latest.version) })}</legend>
                          <p className="section-meta">{t("admin.guardrails.validateHelp")}</p>
                          <input type="hidden" name="guardrail" value={guardrail.id} />
                          <input type="hidden" name="language" value={each} />
                          <input type="hidden" name="version" value={latest.version} />
                          <Field label={t("admin.guardrails.validatorName")}>
                            <TextInput name="name" required autoComplete="name" defaultValue={accountName} />
                          </Field>
                          <button className={buttonClass({ variant: "primary" })} type="submit">
                            {t("admin.guardrails.validate")}
                          </button>
                        </fieldset>
                      </BackOfficeForm>
                    ) : null}
                    <BackOfficeForm canWrite={canWrite} action={saveMessage}>
                      <fieldset className="section-form" disabled={!canWrite}>
                        <legend>{t("admin.guardrails.editTitle", { language: language(each) })}</legend>
                        <input type="hidden" name="guardrail" value={guardrail.id} />
                        <input type="hidden" name="language" value={each} />
                        <Field label={t("admin.guardrails.text")} hint={t(guardrail.id === "distress" ? "admin.guardrails.distressHelp" : "admin.guardrails.textHelp")}>
                          <Textarea name="text" rows={4} required lang={each} defaultValue={latest?.text ?? fallback} />
                        </Field>
                        <button className={buttonClass({ variant: "primary" })} type="submit">
                          {t("admin.guardrails.saveMessage")}
                        </button>
                      </fieldset>
                    </BackOfficeForm>
                  </div>
                </Card>
              );
            })}
          </section>
        ))}

        <section className="section-block" id="eval-runs" aria-labelledby="eval-runs-title">
          <h2 id="eval-runs-title">{t("admin.guardrails.runs.title")}</h2>
          <p>{t("admin.guardrails.runs.intro")}</p>
          {readsRuns ? <EvalRunsTable runs={runs} caption={t("admin.evals.runs.caption")} /> : null}
        </section>

        <section className="section-block" aria-labelledby="triggers-title">
          <h2 id="triggers-title">{t("admin.guardrails.triggers.title")}</h2>
          <p>{t("admin.guardrails.triggers.intro", { days: String(TRIGGER_DAYS), months: String(TRIGGER_RETENTION_MONTHS) })}</p>
          {triggers.length === 0 ? (
            <p>{t("admin.guardrails.triggers.none")}</p>
          ) : (
            <Table
              label={t("admin.guardrails.triggers.caption")}
              columns={[
                { key: "day", header: t("admin.guardrails.triggers.day"), rowHeader: true, cell: (day) => <time dateTime={day.day}>{date.format(new Date(`${day.day}T12:00:00Z`))}</time> },
                { key: "name", header: t("admin.guardrails.name"), cell: (day) => name(day.guardrail) },
                { key: "blocked", header: t("admin.guardrails.triggers.blocked"), numeric: true, cell: (day) => number.format(day.blocked) },
                { key: "flagged", header: t("admin.guardrails.triggers.flagged"), numeric: true, cell: (day) => number.format(day.flagged) },
                {
                  key: "unavailable",
                  header: t("admin.guardrails.triggers.unavailable"),
                  numeric: true,
                  cell: (day) => (
                    <>
                      {number.format(day.unavailable)}
                      {day.unavailable > 0 ? (
                        <ul className="section-list section-meta" aria-label={t("admin.guardrails.triggers.byReasonLabel")}>
                          {UNAVAILABLE_REASONS.filter((reason) => day.unavailableBy[reason] > 0).map((reason) => (
                            <li key={reason}>
                              {t("admin.guardrails.triggers.byReason", {
                                reason: reason === "unrecorded" ? t("admin.guardrails.triggers.reasonUnrecorded") : t(`failureReasons.${reason}`),
                                count: number.format(day.unavailableBy[reason]),
                              })}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ),
                },
              ]}
              rows={triggers}
              rowKey={(day) => `${day.day} ${day.guardrail}`}
            />
          )}
        </section>
      </div>
    </BackOfficeLayout>
  );
}
