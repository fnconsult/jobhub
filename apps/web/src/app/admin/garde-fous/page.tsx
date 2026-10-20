import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getGuardrailsBackOffice, requireBackOffice } from "@/admin/server";
import { getCurrentCandidate } from "@/auth/server";
import { playbookServing } from "@/coaching-playbooks/serving";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { GUARDRAIL_LANGUAGES, GUARDRAIL_SETTINGS, type GuardrailId, type GuardrailLanguage } from "@/guardrails";
import { getGuardrailStore, guardrailTriggersOfLastDays } from "@/guardrails/server";
import { TRIGGER_RETENTION_MONTHS, type GuardrailMessageVersion } from "@/guardrails/store";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

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
} as const;
type Notice = keyof typeof NOTICES;
const isNotice = (value: unknown): value is Notice => typeof value === "string" && Object.hasOwn(NOTICES, value);

/** How many days of Guardrail Triggers the page shows. */
const TRIGGER_DAYS = 30;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("guardrails");
  const t = await getServerT();
  return { title: `${t("admin.guardrails.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const back = (notice: Notice, anchor?: string): never => redirect(`${routes.adminGuardrails}?notice=${notice}${anchor ? `#${anchor}` : ""}`);

async function saveSetting(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("guardrails", "write");
  const id = String(form.get("guardrail"));
  const done = await getGuardrailsBackOffice().setSetting(administrator, id, form.get("setting"));
  back(done.ok ? (done.changed ? "settingSaved" : "unchanged") : done.error, id);
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
 * name no one and hold no text.
 */
export default async function GuardrailsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { access, canWrite } = await requireBackOffice("guardrails");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { notice } = await searchParams;
  const shown = isNotice(notice) ? notice : null;
  const [guardrails, triggers] = await Promise.all([getGuardrailStore().list(), guardrailTriggersOfLastDays(TRIGGER_DAYS)]);
  const accountName = (await getCurrentCandidate())?.name?.trim() ?? "";
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Paris" });
  const number = new Intl.NumberFormat(locale);
  const validation = (message: GuardrailMessageVersion) =>
    message.validation ? t("admin.guardrails.validatedBy", { name: message.validation.name, date: date.format(message.validation.at) }) : t("admin.guardrails.notValidated");
  const name = (id: GuardrailId) => t(`admin.guardrails.names.${id}`);
  const language = (each: GuardrailLanguage) => t(`admin.guardrails.languages.${each}`);

  return (
    <BackOfficeLayout access={access}>
      <h1>{t("admin.guardrails.title")}</h1>
      <p className="lead">{t("admin.guardrails.intro")}</p>
      <p>{t(playbookServing(process.env) === "validated" ? "admin.guardrails.servingValidated" : "admin.guardrails.servingLatest")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {shown ? (
        <p className="notice" role={NOTICES[shown] ? "alert" : "status"}>
          {t(`admin.guardrails.notices.${shown}`)}
        </p>
      ) : null}

      <div className="table-scroll">
        <table className="application-table">
          <caption>{t("admin.guardrails.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.guardrails.name")}</th>
              <th scope="col">{t("admin.guardrails.guardsAgainst")}</th>
              <th scope="col">{t("admin.guardrails.setting")}</th>
            </tr>
          </thead>
          <tbody>
            {guardrails.map((guardrail) => (
              <tr key={guardrail.id}>
                <th scope="row">
                  <a href={`#${guardrail.id}`}>{name(guardrail.id)}</a>
                </th>
                <td>{t(`admin.guardrails.descriptions.${guardrail.id}`)}</td>
                <td>{guardrail.alwaysOn ? t("admin.guardrails.alwaysOn") : t(`admin.guardrails.settings.${guardrail.setting}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {guardrails.map((guardrail) => (
        <section key={guardrail.id} id={guardrail.id} className="stack" aria-labelledby={`${guardrail.id}-title`}>
          <h2 id={`${guardrail.id}-title`}>{name(guardrail.id)}</h2>
          <p>{t(`admin.guardrails.descriptions.${guardrail.id}`)}</p>
          {guardrail.alwaysOn ? (
            <p>{t("admin.guardrails.alwaysOnHelp")}</p>
          ) : (
            <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={saveSetting}>
              <fieldset disabled={!canWrite}>
                <legend>{t("admin.guardrails.setting")}</legend>
                <input type="hidden" name="guardrail" value={guardrail.id} />
                <label htmlFor={`${guardrail.id}-setting`}>{t("admin.guardrails.settingLabel")}</label>
                <select id={`${guardrail.id}-setting`} className="input" name="setting" defaultValue={guardrail.setting} aria-describedby={`${guardrail.id}-setting-help`}>
                  {GUARDRAIL_SETTINGS.map((setting) => (
                    <option key={setting} value={setting}>
                      {t(`admin.guardrails.settings.${setting}`)}
                    </option>
                  ))}
                </select>
                <p id={`${guardrail.id}-setting-help`}>{t("admin.guardrails.settingHelp")}</p>
                <button className="button button-primary" type="submit">
                  {t("admin.guardrails.saveSetting")}
                </button>
              </fieldset>
            </BackOfficeForm>
          )}

          {GUARDRAIL_LANGUAGES.map((each) => {
            const { latest, served, default: fallback } = guardrail.messages[each];
            const prefix = `${guardrail.id}-${each}`;
            return (
              <div key={each} className="stack">
                <h3>{t("admin.guardrails.messageTitle", { language: language(each) })}</h3>
                <dl>
                  <dt>{t("admin.guardrails.served")}</dt>
                  <dd lang={each}>{served ? served.text : fallback}</dd>
                  <dd>{served ? `${t("admin.guardrails.version", { version: String(served.version) })}, ${validation(served)}` : t("admin.guardrails.defaultText")}</dd>
                  {latest && latest.version !== served?.version ? (
                    <>
                      <dt>{t("admin.guardrails.latest")}</dt>
                      <dd lang={each}>{latest.text}</dd>
                      <dd>{`${t("admin.guardrails.version", { version: String(latest.version) })}, ${t("admin.guardrails.writtenBy", { author: latest.author })}, ${validation(latest)}`}</dd>
                    </>
                  ) : null}
                </dl>
                {latest && !latest.validation ? (
                  <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={validateMessage}>
                    <fieldset disabled={!canWrite}>
                      <legend>{t("admin.guardrails.validateTitle", { language: language(each), version: String(latest.version) })}</legend>
                      <p>{t("admin.guardrails.validateHelp")}</p>
                      <input type="hidden" name="guardrail" value={guardrail.id} />
                      <input type="hidden" name="language" value={each} />
                      <input type="hidden" name="version" value={latest.version} />
                      <label htmlFor={`${prefix}-validator`}>{t("admin.guardrails.validatorName")}</label>
                      <input id={`${prefix}-validator`} className="input" name="name" required autoComplete="name" defaultValue={accountName} />
                      <button className="button button-primary" type="submit">
                        {t("admin.guardrails.validate")}
                      </button>
                    </fieldset>
                  </BackOfficeForm>
                ) : null}
                <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={saveMessage}>
                  <fieldset disabled={!canWrite}>
                    <legend>{t("admin.guardrails.editTitle", { language: language(each) })}</legend>
                    <input type="hidden" name="guardrail" value={guardrail.id} />
                    <input type="hidden" name="language" value={each} />
                    <label htmlFor={`${prefix}-text`}>{t("admin.guardrails.text")}</label>
                    <textarea
                      id={`${prefix}-text`}
                      className="input"
                      name="text"
                      rows={4}
                      required
                      lang={each}
                      defaultValue={latest?.text ?? fallback}
                      aria-describedby={`${prefix}-text-help`}
                    />
                    <p id={`${prefix}-text-help`}>{t(guardrail.id === "distress" ? "admin.guardrails.distressHelp" : "admin.guardrails.textHelp")}</p>
                    <button className="button button-primary" type="submit">
                      {t("admin.guardrails.saveMessage")}
                    </button>
                  </fieldset>
                </BackOfficeForm>
              </div>
            );
          })}
        </section>
      ))}

      <section className="stack" aria-labelledby="triggers-title">
        <h2 id="triggers-title">{t("admin.guardrails.triggers.title")}</h2>
        <p>{t("admin.guardrails.triggers.intro", { days: String(TRIGGER_DAYS), months: String(TRIGGER_RETENTION_MONTHS) })}</p>
        {triggers.length === 0 ? (
          <p>{t("admin.guardrails.triggers.none")}</p>
        ) : (
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.guardrails.triggers.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.guardrails.triggers.day")}</th>
                  <th scope="col">{t("admin.guardrails.name")}</th>
                  <th scope="col">{t("admin.guardrails.triggers.blocked")}</th>
                  <th scope="col">{t("admin.guardrails.triggers.flagged")}</th>
                  <th scope="col">{t("admin.guardrails.triggers.unavailable")}</th>
                </tr>
              </thead>
              <tbody>
                {triggers.map((day) => (
                  <tr key={`${day.day} ${day.guardrail}`}>
                    <th scope="row">
                      <time dateTime={day.day}>{date.format(new Date(`${day.day}T12:00:00Z`))}</time>
                    </th>
                    <td>{name(day.guardrail)}</td>
                    <td>{number.format(day.blocked)}</td>
                    <td>{number.format(day.flagged)}</td>
                    <td>{number.format(day.unavailable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </BackOfficeLayout>
  );
}
